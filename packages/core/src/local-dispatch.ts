import { executeRun, pendingRuns } from './engine';
import { pool } from '../../db';
import { decisionsEnabled } from './decision-capability';
import type { ExecutionProvider } from '../../providers/src/execution';

/** Poll independently of execution duration. A slow simulator must not hold every
 * other job in its batch back while database/provider capacity remains available. */
export class LocalDispatcher {
  private readonly active = new Map<string, Promise<void>>();
  constructor(
    private readonly provider?: ExecutionProvider,
    private readonly onError = () => {
      console.error('A simulator job failed; execution identity remains fenced.');
    },
  ) {}
  async tick() {
    // Active lightweight requests need durable advancement after a restart, too.
    // Native simulator runs retain their existing single-process lifecycle.
    const active = decisionsEnabled() ? (await pool.query<{ organization_id: string; resource_id: string }>(
      "SELECT organization_id,id AS resource_id FROM reporting.scheduling_runs WHERE kind IN ('inference','bounded_agent') AND status IN ('provisioning','running') ORDER BY started_at LIMIT 20",
    )).rows : [];
    for (const job of [...active, ...await pendingRuns()]) {
      if (this.active.has(job.resource_id) || this.active.size >= 20) continue;
      const task = executeRun(job.organization_id, job.resource_id, this.provider)
        .then(() => {}, this.onError)
        .finally(() => {
          this.active.delete(job.resource_id);
        });
      this.active.set(job.resource_id, task);
    }
  }
  async drain() {
    await Promise.allSettled(this.active.values());
  }
}
