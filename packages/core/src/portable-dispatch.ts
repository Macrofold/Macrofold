import { dispatchFailed, dispatchSucceeded } from './dispatch-failures';
import { pool } from '../../db';
import { advanceCloudRun } from './cloud-engine';
import type { MachineProvider } from './ports';
import type { NativeRunRow } from './runs';
import { orderDispatchJobs, pendingRunCandidates } from './scheduling';
import { claimRun } from './engine';
import { observeWorkerStep } from './worker-diagnostics';
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
) {
  const pending = await observeWorkerStep('candidates', {}, () =>
    pendingRunCandidates(
      Math.max(100, concurrency),
      resource === 'inference' ? 'inference' : resource ? 'native' : undefined,
    ),
  );
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

async function failedJob(job: DispatchJob): Promise<never> {
  await dispatchFailed(job.organization_id, 'run', job.resource_id, 'poller_advance_failed');
  throw new Error('A durable run step failed; its execution identity is retained.');
}

/** Serialize only short SQL admissions in fair order. Concurrent contenders for
 * the same organization/global lock can repeatedly beat the eligible head and
 * then reject themselves. Provider work remains independently concurrent. */
async function startJob(provider: Provider, job: DispatchJob) {
  try {
    if (job.state === 'pending') await claimRun(job.organization_id, job.resource_id);
  } catch {
    return { completion: failedJob(job) };
  }
  return { completion: advanceJob(provider, job) };
}

/** Advance once and retain the SQL state machine's execution identity and retry policy. */
async function advanceJob(provider: Provider, job: DispatchJob) {
  try {
    const fields = { organization_id: job.organization_id, run_id: job.resource_id };
    const result = await observeWorkerStep('advance', fields, () =>
      advanceCloudRun(job.organization_id, job.resource_id, provider),
    );
    await dispatchSucceeded(job.organization_id, 'run', job.resource_id);
    // The exact DB timestamp fences release of the short pending dispatcher lease.
    if (result.queued)
      await pool.query(
        "UPDATE dispatch_jobs SET lease_until=NULL WHERE id=$1 AND state='pending' AND lease_until=$2::timestamptz",
        [job.id, job.claimed_lease_until],
      );
    else
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
  } catch {
    return failedJob(job);
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
  async tick() {
    for (const resource of dispatchClasses) {
      const used = [...this.active.values()].filter((value) => value.resource === resource).length;
      const slots = this.limits[resource] - used;
      if (slots <= 0) continue;
      const claims = await claimJobs(slots, this.organization, [...this.active.keys()], resource);
      for (const job of claims) {
        const { completion } = await startJob(this.provider, job);
        const task = completion
          .then((ready) => {
            this.ready ||= ready;
          })
          .catch(() => {
            // advanceJob persisted its failure budget where possible. A SQL outage
            // leaves the existing claim for recovery; never start a replacement here.
            console.error('A cloud step failed; durable recovery retains execution identity.');
          })
          .finally(() => {
            this.active.delete(job.resource_id);
          });
        this.active.set(job.resource_id, { resource, task });
      }
    }
  }
  async waitForProgress(idleMs = 750) {
    if (this.ready) {
      this.ready = false;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ...[...this.active.values()].map(({ task }) => task),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, idleMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async drain() {
    await Promise.allSettled([...this.active.values()].map(({ task }) => task));
  }
}
