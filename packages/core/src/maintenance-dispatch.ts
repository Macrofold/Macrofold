import { errorDiagnostics } from './error-diagnostics';
import { observeWorkerStep } from './worker-diagnostics';

export type MaintenanceTask = {
  name: string;
  run: () => Promise<Record<string, number>>;
  intervalMs?: number;
  drain?: () => Promise<void>;
};

/** Each component owns its cadence. A slow export cannot delay the next Worker
 * reconciliation, expiry sweep or task wake. SQL still fences cross-process work. */
export class MaintenanceDispatcher {
  private readonly active = new Map<string, Promise<Record<string, number>>>();
  private readonly next = new Map<string, number>();
  constructor(private readonly tasks: readonly MaintenanceTask[]) {}

  private start(task: MaintenanceTask) {
    const current = this.active.get(task.name);
    if (current) return current;
    const pending = Promise.resolve()
      .then(() => observeWorkerStep(`maintenance.${task.name}`, {}, task.run))
      .catch((error: unknown) => {
        console.error(
          JSON.stringify({ code: 'maintenance_failed', component: task.name, ...errorDiagnostics(error) }),
        );
        return { [`${task.name}_failed`]: 1 };
      })
      .finally(() => {
        this.active.delete(task.name);
        this.next.set(task.name, Date.now() + (task.intervalMs ?? 15_000));
      });
    this.active.set(task.name, pending);
    return pending;
  }
  async tick() {
    for (const task of this.tasks)
      if (!this.active.has(task.name) && Date.now() >= (this.next.get(task.name) ?? 0)) this.start(task);
  }
  async sweep() {
    const results = await Promise.all(this.tasks.map((task) => this.start(task)));
    return Object.assign({}, ...results) as Record<string, number>;
  }
  async drain() {
    await Promise.allSettled(this.active.values());
    await Promise.allSettled(this.tasks.map((task) => task.drain?.()));
  }
}
