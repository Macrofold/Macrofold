import { pool } from '../../db';

/** A recovered dispatcher supersedes the previous orchestration owner. Renew
 * before phase I/O; the cloud engine retains its independent phase/VM fence. */
export async function renewWorkflow(org: string, runId: string, generation: number) {
  return Boolean(
    (
      await pool.query(
        `UPDATE dispatch_jobs SET lease_until=now()+interval '5 minutes'
     WHERE organization_id=$1 AND resource_id=$2 AND kind='run' AND state<>'done'
       AND workflow_generation=$3 RETURNING id`,
        [org, runId, generation],
      )
    ).rowCount,
  );
}

/** Commit before notifying dispatch. Cron repairs a lost notification. A stale
 * retry cannot release a new owner, replay the prompt, or settle its reservation. */
export async function releaseWorkflow(org: string, runId: string, generation: number) {
  await pool.query(
    `UPDATE dispatch_jobs SET lease_until=NULL,workflow_generation=workflow_generation+1,
       available_at=CASE WHEN state='running' THEN now() ELSE available_at END
     WHERE organization_id=$1 AND resource_id=$2 AND kind='run' AND state<>'done'
       AND workflow_generation=$3`,
    [org, runId, generation],
  );
}
