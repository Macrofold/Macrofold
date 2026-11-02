import type { Tx } from '../../db';

export const NATIVE_QUESTION_WAIT_SECONDS = 1;

/** The caller owns the authorized Run mutation and its row lock.
 * Controls may shorten an idle probe wait, never steal a live phase or clear
 * recovery backoff. Already-due jobs still need a committed hint while the
 * poller is asleep; the existing due-job trigger supplies it.
 * See docs/projects/native-scheduling-latency.md#quiet-native-controls. */
export async function wakeNativeControl(tx: Tx, runId: string) {
  await tx.query(
    `UPDATE dispatch_jobs j SET available_at=clock_timestamp()
     FROM runs r WHERE r.id=$1 AND r.kind='native_agent'
       AND r.status IN ('running','waiting_for_input')
       AND r.execution_binding->>'phase'='poll'
       AND r.execution_binding->>'controlWait'='true'
       AND r.execution_binding->>'lock' IS NULL
       AND coalesce((r.execution_binding->>'failures')::integer,0)=0
       AND j.kind='run' AND j.resource_id=r.id AND j.state='running'
       AND j.error IS NULL
       AND j.available_at<=clock_timestamp()+($2::integer*interval '1 second')`,
    // A dispatcher claim moves due time two minutes forward before the phase
    // clears controlWait. Never shorten that claim's recovery deadline.
    [runId, NATIVE_QUESTION_WAIT_SECONDS],
  );
}
