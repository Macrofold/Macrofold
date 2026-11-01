import { dispatchFailed, dispatchSucceeded } from './dispatch-failures';
import { pool } from '../../db';
import { advanceCloudRun, type CloudRunContext } from './cloud-engine';
import type { MachineProvider } from './ports';
import type { NativeRunRow } from './runs';
import { orderDispatchJobs, pendingRunCandidates } from './scheduling';
import { claimRun } from './engine';
import { observeWorkerStep } from './worker-diagnostics';
import { errorDiagnostics } from './error-diagnostics';
import { FairAdmissionQueue } from './admission-queue';
import { dispatchClasses, dispatchLimits, type DispatchClass, type DispatchLimits } from './capacity';

type Provider = MachineProvider | ((run: NativeRunRow) => MachineProvider);
type DispatchJob = {
  id: string;
  organization_id: string;
  resource_id: string;
  claimed_lease_until: string | null;
  state: 'pending' | 'running';
};
async function claimJobs(
  concurrency: number,
  organization?: string,
  active: string[] = [],
  resource?: DispatchClass,
  observedPending?: Awaited<ReturnType<typeof pendingRunCandidates>>,
) {
  const pending =
    observedPending ??
    (await observeWorkerStep('candidates', {}, () =>
      pendingRunCandidates(
        Math.max(100, concurrency),
        resource === 'inference' ? 'inference' : resource ? 'native' : undefined,
      ),
    ));
  // Eligibility hints already account for capacity and cleanup. Provider/phase
  // retries still honor available_at; a capacity wait may wake when capacity frees.
  const claims = await observeWorkerStep('claim', {}, () =>
    pool.query<DispatchJob>(
      `WITH due AS (SELECT j.id FROM dispatch_jobs j JOIN reporting.scheduling_runs r ON r.id=j.resource_id
    WHERE j.kind='run' AND j.state IN ('pending','running') AND ($2::uuid IS NULL OR j.organization_id=$2)
    AND ($5::text IS NULL OR r.dispatch_class=$5)
    AND NOT (resource_id=ANY($4::uuid[]))
    AND ((state='running' AND available_at<=now()) OR (state='pending' AND resource_id=ANY($3::uuid[])
      AND (lease_until IS NULL OR lease_until<=now()) AND (error IS NULL OR available_at<=now())))
    ORDER BY CASE state WHEN 'running' THEN 0 ELSE 1 END,array_position($3::uuid[],resource_id),available_at,j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED)
    UPDATE dispatch_jobs j SET available_at=now()+CASE WHEN j.state='pending' THEN interval '5 seconds' ELSE interval '2 minutes' END,
      lease_until=CASE WHEN j.state='pending' THEN now()+interval '5 seconds' ELSE j.lease_until END,error=NULL
    FROM due WHERE j.id=due.id RETURNING j.id,j.organization_id,j.resource_id,j.state,j.lease_until::text AS claimed_lease_until`,
      [concurrency, organization || null, pending.map((p) => p.resource_id), active, resource ?? null],
    ),
  );
  return orderDispatchJobs(claims.rows, pending);
}

async function failedJob(job: DispatchJob, error: unknown): Promise<never> {
  // If recording recovery also fails, that control failure takes precedence:
  // durable retry bookkeeping could not be confirmed.
  await dispatchFailed(job.organization_id, 'run', job.resource_id, 'poller_advance_failed');
  // Internal consumers classify/count the failure; retain its safe diagnostic
  // identity instead of discarding the database cause behind a generic Error.
  throw error;
}

function releasePendingClaim(job: DispatchJob) {
  // Only the exact short claim may be released; another controller's state and
  // due time remain untouched after a lost fair-admission race.
  return pool.query(
    "UPDATE dispatch_jobs SET lease_until=NULL WHERE id=$1 AND state='pending' AND lease_until=$2::timestamptz",
    [job.id, job.claimed_lease_until],
  );
}

/** Serialize only short SQL admissions in fair order. Concurrent contenders for
 * the same organization/global lock can repeatedly beat the eligible head and
 * then reject themselves. Provider work remains independently concurrent. */
async function startJob(
  provider: Provider,
  job: DispatchJob,
  resource?: DispatchClass,
  handoff?: (resource: DispatchClass) => boolean,
) {
  let preparedRun: NativeRunRow | undefined;
  try {
    if (job.state === 'pending') {
      const claimed = await observeWorkerStep(
        'admission',
        { organization_id: job.organization_id, run_id: job.resource_id },
        () => claimRun(job.organization_id, job.resource_id),
      );
      if (!claimed) {
        await releasePendingClaim(job);
        return { completion: Promise.resolve(false) };
      }
      if (claimed.kind === 'native_agent') preparedRun = claimed;
    }
  } catch (error) {
    return { completion: failedJob(job, error) };
  }
  return { completion: advanceJob(provider, job, resource, handoff, preparedRun) };
}

/** Already-admitted native work may transfer a free local slot, never queue for
 * it. One quantum bounds all its advances; SQL remains the recovery owner. */
async function advanceJob(
  provider: Provider,
  job: DispatchJob,
  resource?: DispatchClass,
  handoff?: (resource: DispatchClass) => boolean,
  preparedRun?: NativeRunRow,
) {
  try {
    const fields = { organization_id: job.organization_id, run_id: job.resource_id };
    const started = performance.now();
    let currentResource = resource;
    let retained = false;
    let steps = 0;
    const context: CloudRunContext | undefined =
      preparedRun || (resource && resource !== 'inference') ? { run: preparedRun } : undefined;
    if (context && resource && resource !== 'inference')
      context.retainReady = (next) => {
        if (steps >= 16 || performance.now() - started >= 5000 || next === 'inference') return false;
        if (next !== currentResource && !handoff?.(next)) return false;
        currentResource = next;
        retained = true;
        return true;
      };
    let result: Awaited<ReturnType<typeof advanceCloudRun>>;
    for (;;) {
      steps++;
      retained = false;
      result = await observeWorkerStep('advance', fields, () =>
        advanceCloudRun(job.organization_id, job.resource_id, provider, context),
      );
      if (
        !retained ||
        !result.canContinue ||
        result.nextDispatchClass !== currentResource ||
        result.done ||
        result.queued ||
        result.delaySeconds !== 0
      )
        break;
    }
    // Native phase publication resets the failure budget atomically. Other
    // owners and early-return paths still use the shared dispatcher reset.
    if (!result.nextDispatchClass) await dispatchSucceeded(job.organization_id, 'run', job.resource_id);
    // The exact DB timestamp fences release of the short pending dispatcher lease.
    if (result.queued) await releasePendingClaim(job);
    // Native publication sets its next due time in the fenced phase commit.
    // Retained work keeps a recovery lease until it yields; do not overwrite it.
    else if (!result.nextDispatchClass)
      await observeWorkerStep(
        'reschedule',
        { ...fields, done: result.done, queued: result.queued, delay_seconds: result.delaySeconds },
        () =>
          pool.query(
            "UPDATE dispatch_jobs SET available_at=now()+($2::integer*interval '1 second') WHERE id=$1 AND state IN ('pending','running')",
            [job.id, result.delaySeconds],
          ),
      );
    return !result.done && !result.queued && result.delaySeconds === 0;
  } catch (error) {
    return failedJob(job, error);
  }
}

/** One bounded sweep for callers that intentionally await all selected steps. */
export async function dispatchCloudPoller(provider: Provider, concurrency = 64, organization?: string) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 1024)
    throw new RangeError('Dispatch concurrency must be between 1 and 1024.');
  const claims = await claimJobs(concurrency, organization);
  const tasks: Promise<PromiseSettledResult<boolean>>[] = [];
  for (const job of claims) {
    const { completion } = await startJob(provider, job);
    // Observe rejection now while later admissions are still being awaited.
    tasks.push(
      completion.then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason: unknown) => ({ status: 'rejected' as const, reason }),
      ),
    );
  }
  const results = await Promise.all(tasks);
  return {
    advanced: claims.length,
    failed: results.filter((r) => r.status === 'rejected').length,
    ready: results.some((r) => r.status === 'fulfilled' && r.value),
  };
}

/** Long-lived pollers refill free slots without waiting for the slowest step.
 * SQL still owns fairness, global capacity and cross-process recovery. */
export class CloudDispatcher {
  private readonly active = new Map<string, { resource: DispatchClass; task: Promise<void> }>();
  private readonly discovering = new Map<DispatchClass, number>();
  private readonly scans = new Map<DispatchClass, { task: Promise<void>; again: boolean }>();
  private readonly progressWaiters = new Set<() => void>();
  private readonly admissions = new FairAdmissionQueue();
  private draining?: Promise<void>;
  private readonly limits: DispatchLimits;
  private ready = false;
  constructor(
    private readonly provider: Provider,
    limits: DispatchLimits | number = dispatchLimits(),
    private readonly organization?: string,
  ) {
    this.limits =
      typeof limits === 'number'
        ? { inference: limits, provision: limits, transfer: limits, control: limits }
        : limits;
    for (const value of Object.values(this.limits))
      if (!Number.isSafeInteger(value) || value < 1 || value > 1024)
        throw new RangeError('Dispatch concurrency must be between 1 and 1024.');
  }
  private freeSlots(resource: DispatchClass) {
    const active = [...this.active.values()].filter((value) => value.resource === resource).length;
    return this.limits[resource] - active - (this.discovering.get(resource) ?? 0);
  }
  private progress() {
    this.ready = true;
    for (const resolve of this.progressWaiters) resolve();
  }
  private start(job: DispatchJob, resource: DispatchClass) {
    if (this.active.has(job.resource_id)) return;
    const entry = { resource, task: Promise.resolve() };
    this.active.set(job.resource_id, entry);
    const handoff = (next: DispatchClass) => {
      if (this.freeSlots(next) <= 0) return false;
      entry.resource = next;
      this.progress();
      return true;
    };
    entry.task = (async () => {
      let started: ReturnType<typeof startJob>;
      if (job.state === 'pending') {
        // Preserve FIFO within each class without putting a native head behind
        // an entire inference burst. SQL still grants the actual fair turn.
        started = this.admissions.run(resource === 'inference' ? 'inference' : 'native', () =>
          startJob(this.provider, job, resource, handoff),
        );
      } else started = startJob(this.provider, job, resource, handoff);
      const { completion } = await started;
      await completion;
    })()
      .catch((error: unknown) => {
        // A failed advance retains its durable identity and failure budget.
        console.error(JSON.stringify({ code: 'poller_advance_failed', ...errorDiagnostics(error) }));
      })
      .finally(() => {
        this.active.delete(job.resource_id);
        this.progress();
      });
  }
  async tick() {
    if (this.draining) return;
    // Each class refills independently. A hung query must not stop later ticks
    // from refilling another class after its first quantum has finished.
    for (const resource of dispatchClasses) {
      const scan = this.scans.get(resource);
      if (scan) {
        // A wake may arrive after the scan's eligibility snapshot. Coalesce it
        // into one fresh scan rather than losing it or queuing one per Run.
        scan.again = true;
        continue;
      }
      if (this.freeSlots(resource) <= 0) continue;
      this.scan(resource);
    }
  }
  private candidates(resource: DispatchClass) {
    // The scheduler view classifies every queued native Run as provision.
    // Running transfer/control phases need no fair-admission candidate scan.
    if (resource === 'transfer' || resource === 'control') return Promise.resolve([]);
    return observeWorkerStep('candidates', {}, () =>
      pendingRunCandidates(
        resource === 'inference'
          ? Math.max(100, this.limits.inference)
          : Math.max(100, this.limits.provision, this.limits.transfer, this.limits.control),
        resource === 'inference' ? 'inference' : 'native',
      ),
    );
  }
  private scan(resource: DispatchClass) {
    const scan = { task: Promise.resolve(), again: false };
    this.scans.set(resource, scan);
    scan.task = this.discover(resource)
      .catch((error: unknown) => {
        // Contain the detached scan; no claimed external execution is replayed.
        console.error(
          JSON.stringify({
            code: 'run_dispatch_unavailable',
            dispatch_class: resource,
            ...errorDiagnostics(error),
          }),
        );
      })
      .finally(() => {
        this.scans.delete(resource);
        if (scan.again && !this.draining && this.freeSlots(resource) > 0) this.scan(resource);
      });
  }
  private async discover(resource: DispatchClass) {
    const pending = await this.candidates(resource);
    const slots = this.freeSlots(resource);
    if (slots <= 0) return;
    // Reserve in-flight SQL claims too: a handoff cannot consume slots that
    // this discovery may already have claimed on another database connection.
    this.discovering.set(resource, slots);
    try {
      const claims = await claimJobs(slots, this.organization, [...this.active.keys()], resource, pending);
      this.discovering.delete(resource);
      for (const job of claims) this.start(job, resource);
    } finally {
      this.discovering.delete(resource);
    }
  }
  async waitForProgress(idleMs = 750, signal?: AbortSignal) {
    if (signal?.aborted) return;
    if (this.ready) {
      this.ready = false;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let onProgress: (() => void) | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          onProgress = resolve;
          this.progressWaiters.add(resolve);
        }),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, idleMs);
        }),
        ...(signal
          ? [
              new Promise<void>((resolve) => {
                onAbort = resolve;
                signal.addEventListener('abort', onAbort, { once: true });
                if (signal.aborted) resolve();
              }),
            ]
          : []),
      ]);
    } finally {
      clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      if (onProgress) this.progressWaiters.delete(onProgress);
      this.ready = false;
    }
  }
  drain() {
    return (this.draining ??= (async () => {
      await Promise.allSettled([...this.scans.values()].map(({ task }) => task));
      await Promise.allSettled([...this.active.values()].map(({ task }) => task));
    })().finally(() => {
      this.draining = undefined;
    }));
  }
}
