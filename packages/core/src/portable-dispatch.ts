import { pool } from '../../db';
import { advanceCloudRun } from './cloud-engine';
import type { MachineProvider } from './ports';
import { pendingRunCandidates } from './scheduling';
import { observeWorkerStep } from './worker-diagnostics';
/** The SQL state machine owns execution identity in either orchestration backend.
 * Claim due work, advance once, and durably schedule its next observation. */
export async function dispatchCloudPoller(
  provider: MachineProvider | ((run: import('./runs').NativeRunRow) => MachineProvider),
  concurrency = 4,
  organization?: string,
) {
  const pending = await observeWorkerStep('candidates', {}, () => pendingRunCandidates(100));
  // Eligibility hints already account for capacity and cleanup. A queued Run's
  // earlier backoff must not hide the fair winner after that capacity becomes free.
  // Provider/phase retries retain their own available_at deadline while running.
  const claims = await observeWorkerStep('claim', {}, () =>
    pool.query(
      `WITH due AS (SELECT id FROM dispatch_jobs WHERE kind='run' AND state<>'done' AND ($2::uuid IS NULL OR organization_id=$2)
    AND ((state='running' AND available_at<=now()) OR (state='pending' AND resource_id=ANY($3::uuid[])
      AND (lease_until IS NULL OR lease_until<=now()) AND (error IS NULL OR available_at<=now())))
    ORDER BY CASE WHEN state='running' THEN 0 ELSE 1 END,array_position($3::uuid[],resource_id),available_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    UPDATE dispatch_jobs j SET available_at=now()+CASE WHEN j.state='pending' THEN interval '5 seconds' ELSE interval '2 minutes' END,
      lease_until=CASE WHEN j.state='pending' THEN now()+interval '5 seconds' ELSE j.lease_until END,error=NULL
    FROM due WHERE j.id=due.id RETURNING j.id,j.organization_id,j.resource_id,j.lease_until::text AS claimed_lease_until`,
      [Math.max(1, Math.min(20, concurrency)), organization || null, pending.map((p) => p.resource_id)],
    ),
  );
  const results = await Promise.allSettled(
    claims.rows.map(async (job) => {
      try {
        const fields = { organization_id: job.organization_id, run_id: job.resource_id };
        const result = await observeWorkerStep('advance', fields, () =>
          advanceCloudRun(job.organization_id, job.resource_id, provider),
        );
        // Keep a short dispatcher lease separate from capacity-wait backoff.
        // Comparing its exact DB timestamp prevents a stale caller clearing a new claim.
        if (result.queued)
          await pool.query(
            "UPDATE dispatch_jobs SET lease_until=NULL WHERE id=$1 AND state='pending' AND lease_until=$2::timestamptz",
            [job.id, job.claimed_lease_until],
          );
        else
          await observeWorkerStep(
            'reschedule',
            {
              ...fields,
              done: result.done,
              queued: result.queued,
              delay_seconds: result.delaySeconds,
            },
            () =>
              pool.query(
                "UPDATE dispatch_jobs SET available_at=now()+($2::integer*interval '1 second') WHERE id=$1 AND state<>'done'",
                [job.id, result.delaySeconds],
              ),
          );
        return !result.done && !result.queued && result.delaySeconds === 0;
      } catch {
        await pool.query(
          "UPDATE dispatch_jobs SET available_at=now()+interval '30 seconds',error='poller_advance_failed' WHERE id=$1 AND state<>'done'",
          [job.id],
        );
        throw new Error('A durable run step failed; its execution identity is retained.');
      }
    }),
  );
  return {
    advanced: claims.rowCount || 0,
    failed: results.filter((r) => r.status === 'rejected').length,
    ready: results.some((r) => r.status === 'fulfilled' && r.value),
  };
}
