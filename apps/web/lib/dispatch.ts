import { start } from 'workflow/api';
import { pool } from '@platform/db';
import { config, isLocal } from '@platform/core/config';
import { agentRun } from '../workflows/run';
import { pendingRunCandidates } from '@platform/core/scheduling';
import { claimRun } from '@platform/core/engine';

/** The committed outbox is authoritative. Losing a start() response may create a second
 * Workflow, but it cannot create a second native execution; the domain lease and VM marker fence it. */
export async function dispatchRuns(capacityFreed = false) {
  if (isLocal() || config.execution !== 'vercel' || config.orchestration !== 'workflow')
    return { dispatched: 0 };
  const pending = await pendingRunCandidates(100);
  const jobs = await pool.query(
    `UPDATE dispatch_jobs SET lease_until=now()+interval '30 seconds'
    WHERE id IN (SELECT id FROM dispatch_jobs WHERE kind='run' AND state<>'done'
      AND (available_at<=now() OR ($2 AND state='pending')) AND (lease_until IS NULL OR lease_until<now())
      AND (state='running' OR resource_id=ANY($1::uuid[]))
      ORDER BY array_position($1::uuid[],resource_id),available_at FOR UPDATE SKIP LOCKED LIMIT 10)
    RETURNING organization_id,resource_id,state`,
    [pending.map((p) => p.resource_id), capacityFreed],
  );
  let dispatched = 0;
  for (const job of jobs.rows) {
    try {
      // Waiting lives in PostgreSQL, not a five-second Workflow sleep loop. A day
      // of queue tolerance must not consume a Workflow's bounded event history.
      if (job.state === 'pending' && !(await claimRun(job.organization_id, job.resource_id))) {
        await pool.query(
          "UPDATE dispatch_jobs SET lease_until=NULL,available_at=now()+interval '5 seconds' WHERE kind='run' AND resource_id=$1 AND state='pending'",
          [job.resource_id],
        );
        continue;
      }
      await start(agentRun, [job.organization_id, job.resource_id]);
      dispatched++;
    } catch {
      await pool.query(
        "UPDATE dispatch_jobs SET lease_until=now()+interval '30 seconds',error='workflow_dispatch_failed' WHERE resource_id=$1 AND kind='run'",
        [job.resource_id],
      );
    }
  }
  return { dispatched };
}
