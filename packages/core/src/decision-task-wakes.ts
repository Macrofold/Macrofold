import { afterCommit, type Tx } from '../../db';

type Wake = { organization: string; task: string };
const pending = new Map<string, Wake>();
const active = new Map<string, Promise<void>>();
let scheduled: NodeJS.Immediate | undefined;

/** Acceleration is a bounded opaque hint, never the durable owner. A lost hint,
 * saturated process or process death falls back to the ready SQL dispatch job. */
function nudge(wake: Wake) {
  const key = `${wake.organization}:${wake.task}`;
  if (!pending.has(key) && pending.size >= 64) return;
  pending.set(key, wake);
  schedule();
}
function schedule() {
  if (scheduled || !pending.size || active.size >= 4) return;
  scheduled = setImmediate(() => {
    scheduled = undefined;
    for (const [key, wake] of pending) {
      if (active.size >= 4) break;
      if (active.has(key)) continue;
      pending.delete(key);
      const work = Promise.resolve()
        .then(async () => {
          const { advanceTask } = await import('./decision-task-engine');
          await advanceTask(wake.organization, wake.task);
        })
        .catch(() => {
          // The durable job retains its ordinary retry/failure policy.
          console.error(JSON.stringify({ code: 'task_progress_hint_failed', task_id: wake.task }));
        })
        .finally(() => {
          active.delete(key);
          schedule();
        });
      active.set(key, work);
    }
  });
}

export async function drainTaskProgress() {
  while (scheduled || active.size || pending.size) {
    if (scheduled) await new Promise<void>((resolve) => setImmediate(resolve));
    if (active.size) await Promise.all(active.values());
    else schedule();
  }
}

/** Called in the same transaction as terminal child publication. Repeated or
 * out-of-order terminal observations only make the existing parent job ready. */
export async function wakeParentTask(tx: Tx, runId: string) {
  const jobs = await tx.query<{ organization_id: string; resource_id: string }>(
    `UPDATE dispatch_jobs j SET state='pending',available_at=now(),lease_until=NULL
     WHERE j.kind='decision_task' AND j.state<>'blocked'
       AND EXISTS(SELECT 1 FROM decision_task_runs t WHERE t.run_id=$1 AND t.task_id=j.resource_id)
     RETURNING j.organization_id,j.resource_id`,
    [runId],
  );
  for (const row of jobs.rows)
    afterCommit(tx, () => nudge({ organization: row.organization_id, task: row.resource_id }));
}
