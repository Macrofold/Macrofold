import { pool } from '../../db';
import { advanceCloudRun } from './cloud-engine';
import type { MachineProvider } from './ports';
import { pendingRunCandidates } from './scheduling';
/** The SQL state machine owns execution identity in either orchestration backend.
 * Claim due work, advance once, and durably schedule its next observation. */
export async function dispatchCloudPoller(provider: MachineProvider, concurrency = 4, organization?: string) {
  const pending = await pendingRunCandidates(100);
  const claims = await pool.query(
    `WITH due AS (SELECT id FROM dispatch_jobs WHERE kind='run' AND state<>'done' AND available_at<=now() AND ($2::uuid IS NULL OR organization_id=$2)
    AND (state='running' OR resource_id=ANY($3::uuid[]))
    ORDER BY CASE WHEN state='running' THEN 0 ELSE 1 END,array_position($3::uuid[],resource_id),available_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    UPDATE dispatch_jobs j SET available_at=now()+CASE WHEN j.state='pending' THEN interval '5 seconds' ELSE interval '2 minutes' END FROM due WHERE j.id=due.id RETURNING j.id,j.organization_id,j.resource_id`,
    [Math.max(1, Math.min(20, concurrency)), organization || null, pending.map((p) => p.resource_id)],
  );
  const results = await Promise.allSettled(
    claims.rows.map(async (job) => {
      try {
        const result = await advanceCloudRun(job.organization_id, job.resource_id, provider);
        await pool.query(
          "UPDATE dispatch_jobs SET available_at=now()+($2::integer*interval '1 second') WHERE id=$1 AND state<>'done'",
          [job.id, Math.max(1, result.delaySeconds)],
        );
      } catch {
        await pool.query(
          "UPDATE dispatch_jobs SET available_at=now()+interval '30 seconds',error='poller_advance_failed' WHERE id=$1 AND state<>'done'",
          [job.id],
        );
        throw new Error('A durable run step failed; its execution identity is retained.');
      }
    }),
  );
  return { advanced: claims.rowCount || 0, failed: results.filter((r) => r.status === 'rejected').length };
}
