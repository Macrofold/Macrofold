import type { Tx } from '../../db';
import type { components } from '../../contracts/api';
type Metric = components['schemas']['Metric'];
const metric = (
  name: string,
  value: string | number | null,
  dimensions?: Record<string, string>,
  status: Metric['status'] = 'known',
): Metric => ({ name, value, unit: 'count', status, ...(dimensions ? { dimensions } : {}) });
/** Account activation requires useful real execution. Simulator successes never activate an account.
 * Cohorts use account creation and exact elapsed days; incomplete cohorts remain explicitly immature. */
export async function growthMetrics(tx: Tx, from: string, to: string, org?: string): Promise<Metric[]> {
  const args = [from, to, org || null];
  const included = "coalesce(o.settings->>'analytics_excluded','false')<>'true'";
  const humans = (
    await tx.query(
      `SELECT count(*)::text AS total,count(*) FILTER(WHERE u."emailVerified")::text AS verified,count(*) FILTER(WHERE u."createdAt">=$1)::text AS new FROM auth."user" u WHERE u."createdAt"<$2 AND EXISTS(SELECT 1 FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=u.id AND ($3::uuid IS NULL OR o.id=$3) AND ${included})`,
      args,
    )
  ).rows[0];
  const activity = (
    await tx.query(
      `SELECT count(DISTINCT a.user_id) FILTER(WHERE a.created_at>=$2::timestamptz-interval '1 day')::text AS dau,count(DISTINCT a.user_id) FILTER(WHERE a.created_at>=$2::timestamptz-interval '7 days')::text AS wau,count(DISTINCT a.user_id)::text AS mau FROM reporting.activity a JOIN organizations o ON o.id=a.organization_id WHERE a.created_at>=$2::timestamptz-interval '30 days' AND a.created_at<$2 AND ($3::uuid IS NULL OR o.id=$3) AND ${included} AND $1::timestamptz<$2`,
      args,
    )
  ).rows[0];
  const accounts = (
    await tx.query(
      `WITH qualified AS (
    SELECT o.id,o.created_at,(SELECT min(r.completed_at) FROM reporting.runs r WHERE r.organization_id=o.id AND r.status='succeeded' AND r.model<>'fixture-model' AND r.completed_at<$2) AS activated_at FROM organizations o WHERE o.created_at<$2 AND ($3::uuid IS NULL OR o.id=$3) AND ${included}
  ) SELECT count(*)::text AS total,count(*) FILTER(WHERE created_at>=$1)::text AS new,count(*) FILTER(WHERE activated_at IS NOT NULL)::text AS activated,count(*) FILTER(WHERE activated_at>=$1)::text AS newly_activated FROM qualified`,
      args,
    )
  ).rows[0];
  const service = (
    await tx.query(
      `SELECT count(DISTINCT a.principal_id)::text AS n FROM api_requests a JOIN organizations o ON o.id=a.organization_id WHERE a.principal_type='service' AND a.status<400 AND a.created_at>=$1 AND a.created_at<$2 AND ($3::uuid IS NULL OR o.id=$3) AND ${included}`,
      args,
    )
  ).rows[0];
  const output: Metric[] = [
    metric('users_total', humans.total),
    metric('users_verified', humans.verified),
    metric('users_new', humans.new),
    metric('accounts_total', accounts.total),
    metric('accounts_new', accounts.new),
    metric('accounts_activated', accounts.activated),
    metric('accounts_newly_activated', accounts.newly_activated),
    metric('human_dau', activity.dau),
    metric('human_wau', activity.wau),
    metric('human_mau', activity.mau),
    metric('active_service_principals', service.n),
  ];
  const days = (
    await tx.query(
      `SELECT to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,count(*)::text AS n FROM organizations o WHERE o.created_at>=$1 AND o.created_at<$2 AND ($3::uuid IS NULL OR o.id=$3) AND ${included} GROUP BY 1 ORDER BY 1`,
      args,
    )
  ).rows;
  for (const row of days) output.push(metric('accounts_new', row.n, { day: row.day }));
  const cohorts = (
    await tx.query(
      `WITH cohort AS (SELECT o.id,o.created_at,to_char(date_trunc('week',o.created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD') AS week FROM organizations o WHERE o.created_at>=$1 AND o.created_at<$2 AND ($3::uuid IS NULL OR o.id=$3) AND ${included})
    SELECT c.week,count(*)::text AS size,count(*) FILTER(WHERE c.created_at<=$2::timestamptz-interval '7 days')::text AS eligible_7d,
    count(*) FILTER(WHERE c.created_at<=$2::timestamptz-interval '7 days' AND EXISTS(SELECT 1 FROM reporting.runs r WHERE r.organization_id=c.id AND r.model<>'fixture-model' AND r.status='succeeded' AND r.completed_at>=c.created_at AND r.completed_at<c.created_at+interval '7 days'))::text AS activated_7d,
    count(*) FILTER(WHERE c.created_at<=$2::timestamptz-interval '14 days')::text AS eligible_14d,
    count(*) FILTER(WHERE c.created_at<=$2::timestamptz-interval '14 days' AND EXISTS(SELECT 1 FROM reporting.runs r WHERE r.organization_id=c.id AND r.model<>'fixture-model' AND r.status='succeeded' AND r.completed_at>=c.created_at+interval '7 days' AND r.completed_at<c.created_at+interval '14 days'))::text AS retained_week_1
    FROM cohort c GROUP BY c.week ORDER BY c.week`,
      args,
    )
  ).rows;
  for (const c of cohorts)
    for (const name of ['size', 'eligible_7d', 'activated_7d', 'eligible_14d', 'retained_week_1'])
      output.push(
        metric(
          'cohort_' + name,
          c[name],
          { cohort_week: c.week },
          (name === 'activated_7d' && c.eligible_7d === '0') ||
            (name === 'retained_week_1' && c.eligible_14d === '0')
            ? 'insufficient_data'
            : 'known',
        ),
      );
  return output;
}
