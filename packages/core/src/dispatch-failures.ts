import { transaction, type Tx } from '../../db';
import { emit } from './events';
import type { RunRecoveryData } from '../../contracts/run-recovery';

export const MAX_DISPATCH_FAILURES = 8;

export async function blockRunRecovery(tx: Tx, org: string, runId: string, diagnostic: RunRecoveryData) {
  await tx.query(
    "UPDATE dispatch_jobs SET state='blocked',error=$2,lease_until=NULL WHERE kind='run' AND resource_id=$1",
    [runId, diagnostic.cause],
  );
  const changed = await tx.query(
    "UPDATE runs SET result=result||jsonb_build_object('failure_code','run_recovery_required') WHERE id=$1 AND result->>'failure_code' IS DISTINCT FROM 'run_recovery_required' RETURNING id",
    [runId],
  );
  if (changed.rowCount) await emit(tx, org, runId, 'run.recovery_required', diagnostic);
}

/** A poison job must not retry forever. Keep uncertain identity and holds;
 * blocking dispatch is not proof of completion or permission to replay effects.
 * See docs/projects/bounded-work.md. Delivery attempts remain monotonic. */
export async function dispatchFailed(
  org: string,
  kind: string,
  resourceId: string,
  code: string,
  generation?: number,
) {
  return transaction(org, async (tx) => {
    const result = await tx.query<{ state: string; failure_attempts: number }>(
      `UPDATE dispatch_jobs SET
      failure_attempts=failure_attempts+1,
      state=CASE WHEN failure_attempts+1 >= $5 THEN 'blocked' ELSE state END,
      available_at=now()+interval '30 seconds',lease_until=NULL,error=$4
      WHERE organization_id=$1 AND kind=$2 AND resource_id=$3 AND state IN ('pending','running')
      AND ($6::integer IS NULL OR workflow_generation=$6) RETURNING state,failure_attempts`,
      [org, kind, resourceId, code, MAX_DISPATCH_FAILURES, generation ?? null],
    );
    const blocked = result.rows[0]?.state === 'blocked';
    if (blocked && kind === 'run')
      await blockRunRecovery(tx, org, resourceId, {
        code: 'run_recovery_required',
        step: 'dispatch',
        cause: code,
        attempts: result.rows[0].failure_attempts,
      });
    if (blocked && kind === 'operation')
      await tx.query('UPDATE operations SET data=data||$2::jsonb WHERE id=$1', [
        resourceId,
        JSON.stringify({
          status: 'failed',
          error: {
            code: 'operation_retry_exhausted',
            message: 'Automatic recovery stopped. Inspect the operation before retrying.',
            request_id: resourceId,
            retryable: false,
          },
        }),
      ]);
    if (blocked && kind === 'decision_task')
      await tx.query(
        "UPDATE decision_tasks SET status='stopped',failure_code='task_retry_exhausted' WHERE id=$1",
        [resourceId],
      );
    return blocked;
  });
}

export async function dispatchSucceeded(org: string, kind: string, resourceId: string, generation?: number) {
  await transaction(org, (tx) =>
    tx.query(
      `UPDATE dispatch_jobs SET failure_attempts=0,error=NULL
    WHERE organization_id=$1 AND kind=$2 AND resource_id=$3 AND state IN ('pending','running')
    AND ($4::integer IS NULL OR workflow_generation=$4)`,
      [org, kind, resourceId, generation ?? null],
    ),
  );
}
