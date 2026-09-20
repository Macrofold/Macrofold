import { pool, transaction, type Tx } from '../../db';
import { saveContent } from '../../providers/src/storage';
import { storagePreparation } from './storage-preparation';
import { canonical, unseal } from './crypto';
import { digest } from './explicit-context';
import { assert, AppError } from './errors';
import { actorAuthorized } from './actor-authorization';
import { requireDecisionWorkspace } from './decision-authority';
import { getRun, terminal } from './runs';
import type { ExplicitContext } from './decision';
import {
  taskRow,
  taskTotals,
  admitTaskChild,
  releaseTaskEvidence,
  holdEvidence,
  type TaskRow,
} from './decision-tasks';
import * as resources from './resources';

async function load(tx: Tx, taskId: string) {
  const row = (await tx.query<TaskRow>('SELECT * FROM decision_tasks WHERE id=$1 FOR UPDATE', [taskId]))
    .rows[0];
  assert(row, 404, 'not_found', 'Task not found.');
  return row;
}
/** Coordinator transitions contain no model execution. Waiting releases all run
 * capacity; each child goes through normal authorization, queueing and billing. */
export async function advanceTask(org: string, taskId: string) {
  const publication = await transaction(org, async (tx) => {
    const task = await load(tx, taskId);
    await tx.query(
      `UPDATE decision_task_runs t SET committed_micro_usd=r.budget_used_micro_usd
      FROM runs r WHERE t.task_id=$1 AND t.run_id=r.id AND t.committed_micro_usd IS NULL
      AND r.status IN ('succeeded','failed','cancelled','timed_out')`,
      [taskId],
    );
    const totals = await taskTotals(tx, taskId);
    if (task.evidence_expires_at.getTime() <= Date.now()) task.close_requested = true;
    if (task.close_requested) {
      await tx.query('UPDATE decision_tasks SET close_requested=true WHERE id=$1', [taskId]);
      await tx.query(
        'UPDATE runs SET cancel_requested=true WHERE id IN (SELECT run_id FROM decision_task_runs WHERE task_id=$1 AND committed_micro_usd IS NULL)',
        [taskId],
      );
      if (
        BigInt(totals.outstanding) > 0n ||
        (
          await tx.query(
            'SELECT 1 FROM decision_task_runs WHERE task_id=$1 AND committed_micro_usd IS NULL',
            [taskId],
          )
        ).rowCount
      )
        return null;
      await tx.query("UPDATE decision_tasks SET status='closed' WHERE id=$1", [taskId]);
      await releaseTaskEvidence(tx, task);
      return null;
    }
    if (!['running', 'needs_investigation', 'publishing'].includes(task.status)) return null;
    const child = (
      await tx.query<{ run_id: string; step: 'decide' | 'investigate' }>(
        'SELECT run_id,step FROM decision_task_runs WHERE task_id=$1 AND wake_id=$2 ORDER BY step DESC LIMIT 1',
        [taskId, task.latest_wake_id],
      )
    ).rows[0];
    if (!child) return null;
    const run = await getRun(tx, child.run_id);
    if (!terminal(run.status)) return null;
    const receipt = run.result.inference;
    if (run.status !== 'succeeded' || receipt?.outcome !== 'value') {
      await tx.query("UPDATE decision_tasks SET status='stopped',failure_code=$2 WHERE id=$1", [
        taskId,
        run.result.failure_code || receipt?.outcome || 'child_failed',
      ]);
      await releaseTaskEvidence(tx, { ...task, close_requested: true });
      return null;
    }
    if (
      child.step === 'decide' &&
      task.recipe.investigate &&
      digest(receipt.value) === digest(task.recipe.investigate_when)
    ) {
      // A failed child admission must not roll back the completed child's accounting.
      await tx.query('SAVEPOINT child_admission');
      try {
        assert(
          await actorAuthorized(tx, run),
          403,
          'authorization_revoked',
          'The task credential is no longer authorized.',
        );
        const wake = (
          await tx.query<{ input_ciphertext: string }>(
            'SELECT input_ciphertext FROM decision_task_wakes WHERE id=$1',
            [task.latest_wake_id],
          )
        ).rows[0];
        const evidence = unseal<{
          input: unknown;
          context: ExplicitContext;
          context_reference?: import('../../contracts/api').components['schemas']['ContextReference'];
        }>(wake.input_ciphertext);
        const context: ExplicitContext = {
          ...evidence.context,
          items: [
            ...evidence.context.items,
            {
              id: 'task_decision',
              kind: 'inference',
              status: 'known',
              source: `run:${run.id}`,
              source_revision: receipt.definition_digest,
              observed_at: run.completed_at!.toISOString(),
              value: receipt.value,
            },
          ],
        };
        await admitTaskChild(tx, task, task.latest_wake_id!, 'investigate', {
          workspace_id: task.workspace_id,
          ...task.recipe.investigate,
          input: evidence.input,
          context,
          context_reference: evidence.context_reference,
        });
        await tx.query('RELEASE SAVEPOINT child_admission');
      } catch (error) {
        await tx.query('ROLLBACK TO SAVEPOINT child_admission');
        if (!(error instanceof AppError) || error.status >= 500) throw error;
        await tx.query("UPDATE decision_tasks SET status='stopped',failure_code=$2 WHERE id=$1", [
          taskId,
          error.code,
        ]);
        await releaseTaskEvidence(tx, { ...task, close_requested: true });
      }
      return null;
    }
    await tx.query("UPDATE decision_tasks SET status='publishing' WHERE id=$1", [taskId]);
    return { task, run, receipt };
  });
  if (publication) {
    const { task, run, receipt } = publication;
    const preparation = await storagePreparation(org, async (tx) => {
      const current = await taskRow(tx, task.principal, taskId);
      assert(current.status === 'publishing', 409, 'task_changed', 'The task changed before publication.');
    });
    try {
      const bytes = Buffer.from(
        canonical({
          run_id: run.id,
          task_id: taskId,
          wake_id: task.latest_wake_id,
          state: 'structurally_validated',
          receipt,
        }),
      );
      const object = await saveContent(org, bytes);
      await transaction(org, async (tx) => {
        const current = await load(tx, taskId);
        if (
          current.close_requested ||
          current.status !== 'publishing' ||
          current.latest_wake_id !== task.latest_wake_id
        )
          return;
        if (current.evidence_expires_at.getTime() <= Date.now()) {
          await tx.query("UPDATE decision_tasks SET status='closed',close_requested=true WHERE id=$1", [
            taskId,
          ]);
          await releaseTaskEvidence(tx, current);
          return;
        }
        await requireDecisionWorkspace(tx, task.principal, task.workspace_id);
        if (!(await actorAuthorized(tx, run))) {
          await tx.query(
            "UPDATE decision_tasks SET status='stopped',failure_code='authorization_revoked' WHERE id=$1",
            [taskId],
          );
          await releaseTaskEvidence(tx, { ...current, close_requested: true });
          return;
        }
        await preparation.assertActive(tx);
        const artifact = await resources.create(tx, 'artifacts', org, {
          ...object,
          workspace_id: task.workspace_id,
          run_id: run.id,
          name: `proposal-${task.latest_wake_id}.json`,
          media_type: 'application/json',
          kind: 'proposal',
          retention: 'published',
        });
        await holdEvidence(tx, org, taskId, artifact.id);
        await tx.query("UPDATE decision_tasks SET status='proposal',proposal_artifact_id=$2 WHERE id=$1", [
          taskId,
          artifact.id,
        ]);
      });
    } finally {
      await preparation.dispose();
    }
  }
  return transaction(org, async (tx) => {
    const task = await load(tx, taskId);
    const done =
      (['waiting', 'proposal', 'stopped', 'closed'].includes(task.status) && !task.close_requested) ||
      task.status === 'closed';
    await tx.query(
      "UPDATE dispatch_jobs SET state=$2,available_at=$3,lease_until=NULL WHERE kind='decision_task' AND resource_id=$1",
      [
        taskId,
        task.status === 'closed' ? 'done' : 'pending',
        done ? task.evidence_expires_at : new Date(Date.now() + 5000),
      ],
    );
    return { done };
  });
}
export async function dispatchDecisionTasks() {
  const jobs =
    await pool.query(`WITH due AS (SELECT id FROM dispatch_jobs WHERE kind='decision_task' AND state<>'done' AND available_at<=now() ORDER BY available_at LIMIT 10 FOR UPDATE SKIP LOCKED)
    UPDATE dispatch_jobs j SET available_at=now()+interval '2 minutes' FROM due WHERE j.id=due.id RETURNING j.organization_id,j.resource_id`);
  for (const job of jobs.rows) {
    try {
      await advanceTask(job.organization_id, job.resource_id);
    } catch {
      await pool.query(
        "UPDATE dispatch_jobs SET available_at=now()+interval '30 seconds',error='task_advance_failed' WHERE kind='decision_task' AND resource_id=$1",
        [job.resource_id],
      );
    }
  }
  return { tasks_advanced: jobs.rowCount || 0 };
}
