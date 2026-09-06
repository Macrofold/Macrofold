import { executeRun, pendingRuns } from './engine';
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
    for (const job of await pendingRuns()) {
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
