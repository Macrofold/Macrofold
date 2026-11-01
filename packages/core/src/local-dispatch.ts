import { dispatchFailed, dispatchSucceeded } from './dispatch-failures';
import { startRun, pendingRuns } from './engine';
import { pool } from '../../db';
import type { ExecutionProvider } from '../../providers/src/execution';
import { dispatchLimits } from './capacity';
import { FairAdmissionQueue } from './admission-queue';
import { errorDiagnostics } from './error-diagnostics';

type DispatchJob = { organization_id: string; resource_id: string; kind: string };

/** Poll independently of execution duration. A slow simulator must not hold every
 * other job in its batch back while database/provider capacity remains available. */
export class LocalDispatcher {
  private readonly active = new Map<string, { kind: string; task: Promise<void> }>();
  private readonly admissions = new FairAdmissionQueue();
  constructor(
    private readonly provider?: ExecutionProvider,
    private readonly onError: (error: unknown) => void = (error) => {
      console.error(JSON.stringify({ code: 'local_dispatch_failed', ...errorDiagnostics(error) }));
    },
  ) {}
  private start(job: DispatchJob, pending: boolean) {
    // Reserve the slot before its queued admission, and retain it until all
    // execution/failure bookkeeping finishes so drain owns both lifetimes.
    const entry = { kind: job.kind, task: Promise.resolve() };
    this.active.set(job.resource_id, entry);
    entry.task = (async () => {
      const admit = () => startRun(job.organization_id, job.resource_id, this.provider);
      const started = pending
        ? await this.admissions.run(job.kind === 'native_agent' ? 'native' : 'inference', admit)
        : await admit();
      if (!started) return;
      await started.completion;
      await dispatchSucceeded(job.organization_id, 'run', job.resource_id);
    })()
      .catch(async (error: unknown) => {
        await dispatchFailed(job.organization_id, 'run', job.resource_id, 'local_dispatch_failed');
        this.onError(error);
      })
      .catch((error: unknown) => this.onError(error))
      .finally(() => this.active.delete(job.resource_id));
  }
  async tick() {
    const limits = dispatchLimits();
    // Active lightweight requests need durable advancement after a restart, too.
    // Native simulator runs retain their existing single-process lifecycle.
    const active = (
      await pool.query<DispatchJob>(
        "SELECT r.organization_id,r.id AS resource_id,r.kind FROM reporting.scheduling_runs r JOIN dispatch_jobs j ON j.resource_id=r.id AND j.kind='run' WHERE r.kind IN ('inference','bounded_agent') AND r.status IN ('provisioning','running') AND j.state IN ('pending','running') AND j.available_at<=now() AND NOT(r.id=ANY($1::uuid[])) ORDER BY j.available_at LIMIT $2",
        [[...this.active.keys()], limits.inference],
      )
    ).rows;
    const [inference, native] = await Promise.all([
      pendingRuns(limits.inference, 'inference'),
      pendingRuns(limits.control, 'native'),
    ]);
    for (const { job, pending } of [
      ...active.map((job) => ({ job, pending: false })),
      ...[...inference, ...native].map((job) => ({ job, pending: true })),
    ]) {
      const native = job.kind === 'native_agent';
      const limit = native ? limits.control : limits.inference;
      const used = [...this.active.values()].filter(
        (value) => (value.kind === 'native_agent') === native,
      ).length;
      if (this.active.has(job.resource_id) || used >= limit) continue;
      this.start(job, pending);
    }
  }
  async drain() {
    await Promise.allSettled([...this.active.values()].map(({ task }) => task));
  }
}
