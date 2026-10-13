import { dispatchFailed, dispatchSucceeded } from './dispatch-failures';
import { startRun, pendingRuns } from './engine';
import { pool } from '../../db';
import type { ExecutionProvider } from '../../providers/src/execution';
import { dispatchLimits } from './capacity';

/** Poll independently of execution duration. A slow simulator must not hold every
 * other job in its batch back while database/provider capacity remains available. */
export class LocalDispatcher {
  private readonly active = new Map<string, { kind: string; task: Promise<void> }>();
  constructor(
    private readonly provider?: ExecutionProvider,
    private readonly onError = () => {
      console.error('A simulator job failed; execution identity remains fenced.');
    },
  ) {}
  async tick() {
    const limits = dispatchLimits();
    // Active lightweight requests need durable advancement after a restart, too.
    // Native simulator runs retain their existing single-process lifecycle.
    const active = (
      await pool.query<{ organization_id: string; resource_id: string; kind: string }>(
        "SELECT r.organization_id,r.id AS resource_id,r.kind FROM reporting.scheduling_runs r JOIN dispatch_jobs j ON j.resource_id=r.id AND j.kind='run' WHERE r.kind IN ('inference','bounded_agent') AND r.status IN ('provisioning','running') AND j.state IN ('pending','running') AND j.available_at<=now() AND NOT(r.id=ANY($1::uuid[])) ORDER BY j.available_at LIMIT $2",
        [[...this.active.keys()], limits.inference],
      )
    ).rows;
    const [inference, native] = await Promise.all([
      pendingRuns(limits.inference, 'inference'),
      pendingRuns(limits.control, 'native'),
    ]);
    const pending = [...inference, ...native];
    for (const job of [...active, ...pending]) {
      const native = job.kind === 'native_agent';
      const limit = native ? limits.control : limits.inference;
      const used = [...this.active.values()].filter(
        (value) => (value.kind === 'native_agent') === native,
      ).length;
      if (this.active.has(job.resource_id) || used >= limit) continue;
      // Only admission is sequential. Racing all hints against the same
      // organization lock wastes connections and can repeatedly lose its fair turn.
      let started: Awaited<ReturnType<typeof startRun>>;
      try {
        started = await startRun(job.organization_id, job.resource_id, this.provider);
      } catch {
        await dispatchFailed(job.organization_id, 'run', job.resource_id, 'local_dispatch_failed');
        this.onError();
        continue;
      }
      if (!started) continue;
      const task = started.completion
        .then(
          async () => {
            await dispatchSucceeded(job.organization_id, 'run', job.resource_id);
          },
          async () => {
            await dispatchFailed(job.organization_id, 'run', job.resource_id, 'local_dispatch_failed');
            this.onError();
          },
        )
        .catch(() => this.onError())
        .finally(() => {
          this.active.delete(job.resource_id);
        });
      this.active.set(job.resource_id, { kind: job.kind, task });
    }
  }
  async drain() {
    await Promise.allSettled([...this.active.values()].map(({ task }) => task));
  }
}
