import { z } from 'zod';

export const hostRunContextSchema = z.object({
  assignmentId: z.uuid(), handleId: z.uuid(), worktreeId: z.uuid(),
  uid: z.number().int().min(20000).max(2147483646),
  memoryMiB: z.number().int().positive().max(1048576),
});
export type HostRunContext = z.infer<typeof hostRunContextSchema>;
export function hostRunPaths(context: HostRunContext) {
  const value = hostRunContextSchema.parse(context);
  return {
    control: `/platform-control/assignments/${value.assignmentId}`,
    workspace: `/host-data/worktrees/${value.worktreeId}`,
    handle: `/host-data/handles/${value.handleId}`,
    home: `/host-data/handles/${value.handleId}/home`,
    temp: `/host-data/handles/${value.handleId}/tmp`,
  };
}
/** Only unrelated assignments may mutate concurrently; no global slow-command queue. */
export class KeyedCommands {
  private readonly tails = new Map<string, Promise<unknown>>();
  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(action);
    this.tails.set(key, task);
    void task.finally(() => { if (this.tails.get(key) === task) this.tails.delete(key); }).catch(() => {});
    return task;
  }
}
