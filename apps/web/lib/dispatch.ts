import { dispatchFailed } from '@platform/core/dispatch-failures';
import { pool } from '@platform/db';
import { config, isLocal } from '@platform/core/config';
import { orderDispatchJobs, pendingRunCandidates } from '@platform/core/scheduling';
import { claimRun } from '@platform/core/engine';
import { renewWorkflow } from '@platform/core/workflow-ownership';
import { flushTracesInBackground } from './trace-background';
import { capacitySetting } from '@platform/core/capacity';
import { mapConcurrent } from '@platform/core/concurrent';

/** The committed outbox is authoritative. Losing a start() response may create a second
 * Workflow, but it cannot create a second native execution; the domain lease and VM marker fence it. */
export async function dispatchRuns(capacityFreed = false) {
  try {
    return await dispatchPendingRuns(capacityFreed);
  } finally {
    flushTracesInBackground();
  }
}
async function dispatchPendingRuns(capacityFreed: boolean) {
  if (isLocal() || config.execution !== 'vercel' || config.orchestration !== 'workflow')
    return { dispatched: 0 };
  // Load the Workflow runtime only where it is used, before claiming any jobs.
  const [{ start }, { agentRun }] = await Promise.all([import('workflow/api'), import('../workflows/run')]);
  const batch = capacitySetting('WORKFLOW_DISPATCH_BATCH', 100, 1000);
  const pending = await pendingRunCandidates(batch);
  const jobs = await pool.query(
    `UPDATE dispatch_jobs SET lease_until=now()+interval '5 minutes',workflow_generation=workflow_generation+1
    WHERE id IN (SELECT id FROM dispatch_jobs WHERE kind='run' AND state IN ('pending','running')
      AND (available_at<=now() OR ($2 AND state='pending')) AND (lease_until IS NULL OR lease_until<now())
      AND (state='running' OR resource_id=ANY($1::uuid[]))
      ORDER BY CASE state WHEN 'running' THEN 0 ELSE 1 END,
        array_position($1::uuid[],resource_id),available_at FOR UPDATE SKIP LOCKED LIMIT $3)
    RETURNING organization_id,resource_id,state,workflow_generation`,
    [pending.map((p) => p.resource_id), capacityFreed, batch],
  );
  let dispatched = 0;
  // Keep admission ordered, but do not await slow Workflow start acknowledgements
  // before claiming the next eligible Run. Starts have their own bounded pool.
  const ready: typeof jobs.rows = [];
  for (const job of orderDispatchJobs(jobs.rows, pending)) {
    try {
      // Waiting lives in PostgreSQL, not a five-second Workflow sleep loop. A day
      // of queue tolerance must not consume a Workflow's bounded event history.
      if (job.state === 'pending' && !(await claimRun(job.organization_id, job.resource_id))) {
        await pool.query(
          "UPDATE dispatch_jobs SET lease_until=NULL WHERE kind='run' AND resource_id=$1 AND state='pending' AND workflow_generation=$2",
          [job.resource_id, job.workflow_generation],
        );
        continue;
      }
      if (!(await renewWorkflow(job.organization_id, job.resource_id, job.workflow_generation))) continue;
      ready.push(job);
    } catch {
      await dispatchFailed(
        job.organization_id,
        'run',
        job.resource_id,
        'workflow_dispatch_failed',
        job.workflow_generation,
      );
    }
  }
  await mapConcurrent(ready, capacitySetting('WORKFLOW_START_CONCURRENCY', 16, 256), async (job) => {
    try {
      await start(agentRun, [job.organization_id, job.resource_id, job.workflow_generation]);
      dispatched++;
    } catch {
      await dispatchFailed(
        job.organization_id,
        'run',
        job.resource_id,
        'workflow_dispatch_failed',
        job.workflow_generation,
      );
    }
  });
  return { dispatched };
}
