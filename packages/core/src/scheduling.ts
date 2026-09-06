import type { components } from '../../contracts/api';
import { pool, type Tx } from '../../db';
import { globalRunLimit } from './config';
import { plans } from './plans';

// Weighted virtual service counts starts, not runtime. Idle tenants join at the
// current clock, so they neither hoard turns nor repay a lifetime of old usage.
// Waiting earns a bounded age bonus: one quarter of a virtual turn after four minutes.
// Interactive priority remains first; aging never moves work past its workspace writer.
export const schedulingSQL = `WITH plan_limits AS (
 SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(id text,concurrency_limit integer,scheduler_weight integer)
), active AS (
 SELECT organization_id,count(*)::integer AS n FROM reporting.scheduling_runs
 WHERE status IN ('provisioning','running','waiting_for_input','persisting') GROUP BY organization_id
), queue AS (
 SELECT r.*,coalesce(a.n,0) AS account_active,
 least(coalesce(o.run_concurrency_limit,p.concurrency_limit),p.concurrency_limit) AS account_limit,
 p.scheduler_weight,greatest(o.scheduler_finish,c.virtual_time) AS service,
 least(floor(extract(epoch FROM now()-r.created_at)/60),4)/16 AS age_bonus,
 EXISTS(SELECT 1 FROM reporting.scheduling_runs earlier WHERE earlier.workspace_id=r.workspace_id AND
 (earlier.status IN ('provisioning','running','waiting_for_input','persisting') OR
 (earlier.status='queued' AND (earlier.created_at,earlier.id)<(r.created_at,r.id)))) AS workspace_blocked
 FROM reporting.scheduling_runs r JOIN organizations o ON o.id=r.organization_id
 JOIN plan_limits p ON p.id=o.plan CROSS JOIN scheduler_clock c LEFT JOIN active a ON a.organization_id=r.organization_id
 WHERE r.status='queued'
), eligible AS (
 SELECT *,row_number() OVER(PARTITION BY organization_id ORDER BY
 CASE scheduling_class WHEN 'interactive' THEN 0 ELSE 1 END,created_at,id) AS account_order
 FROM queue WHERE NOT workspace_blocked AND NOT unavailable AND NOT cancel_requested AND queue_expires_at>now() AND account_active<account_limit
)`;
export const schedulingParameters = () => [JSON.stringify(plans())];

/** Call under capacity:global. All workers, including Workflow steps, use this
 * decision at admission to execution, so a targeted retry cannot skip a tenant's turn. */
export async function schedulerTurn(tx: Tx) {
  return (
    await tx.query(
      `${schedulingSQL}
    SELECT id,organization_id,service,scheduler_weight FROM eligible
    WHERE account_order=1 AND (SELECT coalesce(sum(n),0) FROM active)<$2
    ORDER BY CASE scheduling_class WHEN 'interactive' THEN 0 ELSE 1 END,service-age_bonus,created_at,id LIMIT 1`,
      [...schedulingParameters(), globalRunLimit()],
    )
  ).rows[0] as { id: string; organization_id: string; service: number; scheduler_weight: number } | undefined;
}

export async function recordTurn(tx: Tx, org: string, turn: { service: number; scheduler_weight: number }) {
  await tx.query('UPDATE organizations SET scheduler_finish=$2 WHERE id=$1', [
    org,
    turn.service + 1 / turn.scheduler_weight,
  ]);
  await tx.query('UPDATE scheduler_clock SET virtual_time=$1 WHERE id=true', [turn.service]);
}

/** Candidate hints improve dispatch efficiency; only schedulerTurn grants capacity.
 * Cleanup is considered before eligibility so expiry/cancellation cannot get stuck
 * behind a busy workspace or a full global ceiling. */
export async function pendingRunCandidates(limit = 20) {
  return (
    await pool.query(
      `${schedulingSQL}
    SELECT organization_id,id AS resource_id FROM (
      SELECT q.organization_id,q.id,0 AS class,0::double precision AS score,q.created_at FROM queue q
      WHERE q.cancel_requested OR q.queue_expires_at<=now() OR q.unavailable
      UNION ALL
      SELECT organization_id,id,CASE scheduling_class WHEN 'interactive' THEN 1 ELSE 2 END,
        service-age_bonus+(account_order-1)::double precision/scheduler_weight,created_at FROM eligible
    ) candidates ORDER BY class,score,created_at,id LIMIT $2`,
      [...schedulingParameters(), limit],
    )
  ).rows as { organization_id: string; resource_id: string }[];
}

export async function queueObservations(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = (
    await tx.query(
      `${schedulingSQL}
    SELECT id,CASE WHEN cancel_requested THEN 'cancellation_requested'
      WHEN queue_expires_at<=now() THEN 'deadline_expired'
      WHEN unavailable THEN 'workspace_unavailable'
      WHEN workspace_blocked THEN 'earlier_workspace_work'
      WHEN account_active>=account_limit THEN 'account_concurrency'
      WHEN (SELECT coalesce(sum(n),0) FROM active)>=$3 THEN 'global_capacity'
      ELSE 'scheduler_turn' END AS reason FROM queue WHERE id=ANY($2::uuid[])`,
      [...schedulingParameters(), ids, globalRunLimit()],
    )
  ).rows;
  return new Map<string, string>(rows.map((r) => [r.id, r.reason]));
}

export async function schedulingReport(
  tx: Tx,
  from: string,
  to: string,
  org?: string,
): Promise<components['schemas']['SchedulingReport']> {
  const capacity = (
    await tx.query(
      `${schedulingSQL} SELECT
    (SELECT coalesce(sum(n),0)::integer FROM active) AS active_executions,
    (SELECT count(*)::integer FROM eligible) AS eligible_queued_jobs,
    (SELECT count(*)::integer FROM queue) AS queued_jobs,
    (SELECT coalesce(max(extract(epoch FROM now()-created_at)),0)::double precision FROM eligible) AS oldest_eligible_wait_seconds`,
      schedulingParameters(),
    )
  ).rows[0];
  const accounts = (
    await tx.query(
      `${schedulingSQL}, waits AS (
    SELECT organization_id,count(*)::integer AS starts,
      avg(extract(epoch FROM started_at-created_at))::double precision AS mean_start_wait_seconds,
      percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM started_at-created_at)) AS p95_start_wait_seconds
    FROM reporting.scheduling_runs WHERE started_at>=$2 AND started_at<$3 GROUP BY organization_id
  ) SELECT o.id AS organization_id,coalesce(a.n,0) AS active_executions,coalesce(w.starts,0) AS starts,
    w.mean_start_wait_seconds,w.p95_start_wait_seconds,
    (SELECT count(*)::integer FROM queue q WHERE q.organization_id=o.id) AS queued_jobs,
    (SELECT count(*)::integer FROM eligible e WHERE e.organization_id=o.id) AS eligible_queued_jobs,
    (SELECT coalesce(max(extract(epoch FROM now()-e.created_at)),0)::double precision FROM eligible e WHERE e.organization_id=o.id) AS oldest_eligible_wait_seconds
    FROM organizations o LEFT JOIN active a ON a.organization_id=o.id LEFT JOIN waits w ON w.organization_id=o.id
    WHERE ($4::uuid IS NULL OR o.id=$4) AND (a.n>0 OR w.starts>0 OR EXISTS(SELECT 1 FROM queue q WHERE q.organization_id=o.id))
    ORDER BY oldest_eligible_wait_seconds DESC,o.id LIMIT 100`,
      [...schedulingParameters(), from, to, org || null],
    )
  ).rows;
  const starts = (
    await tx.query(
      `SELECT count(*)::integer AS starts,
    avg(extract(epoch FROM started_at-created_at))::double precision AS mean_start_wait_seconds,
    percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM started_at-created_at)) AS p95_start_wait_seconds
    FROM reporting.scheduling_runs WHERE started_at>=$1 AND started_at<$2`,
      [from, to],
    )
  ).rows[0];
  return {
    observed_at: new Date().toISOString(),
    global_concurrency_limit: globalRunLimit(),
    ...capacity,
    ...starts,
    accounts,
    accounts_limit: 100,
  };
}
