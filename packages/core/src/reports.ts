import { executionPolicy, planFor, plans } from './plans';
import { schedulingReport } from './scheduling';
import { transaction, type Tx } from '../../db';
import type { Principal } from './auth';
import { requireScopes } from './auth';
import { assert } from './errors';
import { growthMetrics } from './growth';
import { config, realExecutionEnabled, readinessErrors } from './config';
import type { components } from '../../contracts/api';
type Report = components['schemas']['Report'];
type Metric = components['schemas']['Metric'];
export function period(query: URLSearchParams) {
  const to = query.get('to') ? new Date(query.get('to')!) : new Date();
  const from = query.get('from') ? new Date(query.get('from')!) : new Date(to.getTime() - 30 * 86400000);
  assert(
    Number.isFinite(from.getTime()) &&
      Number.isFinite(to.getTime()) &&
      from < to &&
      to.getTime() - from.getTime() <= 366 * 86400000,
    400,
    'invalid_period',
    'Choose a valid reporting period of up to 366 days.',
  );
  return { from: from.toISOString(), to: to.toISOString() };
}
export function report(
  query: URLSearchParams,
  metrics: Metric[],
  missing_sources: string[] = [],
  filters: Record<string, unknown> = {},
): Report {
  return {
    definition_version: '2',
    ...period(query),
    timezone: 'UTC',
    observed_at: new Date().toISOString(),
    missing_sources,
    filters,
    metrics,
  };
}
const metric = (
  name: string,
  value: string | number | null,
  unit = 'count',
  status: Metric['status'] = 'known',
): Metric => ({ name, value, unit, status });
export async function usageReport(tx: Tx, query: URLSearchParams, admin = false, organization?: string) {
  if (!admin && !organization) {
    organization = (await tx.query("SELECT current_setting('app.organization_id',true) AS organization"))
      .rows[0].organization;
    assert(organization, 403, 'forbidden', 'Tenant usage requires an organization context.');
  }
  const dates = period(query);
  const source = admin ? 'reporting.runs' : 'runs';
  const usage = admin ? 'reporting.usage' : 'model_usage';
  const condition = organization ? ' AND organization_id=$3::uuid' : '';
  const args = organization ? [dates.from, dates.to, organization] : [dates.from, dates.to];
  const runs = (
    await tx.query(
      `SELECT count(*)::text AS total,count(*) FILTER(WHERE status='succeeded')::text AS succeeded,count(*) FILTER(WHERE status='failed')::text AS failed,COALESCE(sum(cost_micro_usd),0)::text AS cost,percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM completed_at-started_at)) AS duration_p95 FROM ${source} WHERE created_at>=$1 AND created_at<$2${condition}`,
      args,
    )
  ).rows[0];
  const tokens = (
    await tx.query(
      `SELECT sum(input_tokens)::text AS input,sum(output_tokens)::text AS output,count(*) FILTER(WHERE completeness!='complete')::text AS missing,count(*)::text AS count FROM ${usage} WHERE created_at>=$1 AND created_at<$2${condition}`,
      args,
    )
  ).rows[0];
  const requestCount = (
    await tx.query(
      `SELECT count(*)::text AS count,count(*) FILTER(WHERE status>=400)::text AS errors,count(*) FILTER(WHERE status IS NULL)::text AS incomplete FROM api_requests WHERE created_at>=$1 AND created_at<$2${condition}`,
      args,
    )
  ).rows[0];
  const current: Metric[] = [];
  if (!admin) {
    const counts = (
      await tx.query(
        `SELECT (SELECT count(*)::text FROM projects WHERE coalesce(data->>'archived','false')<>'true' AND coalesce(data->>'deleted','false')<>'true') AS projects,(SELECT count(*)::text FROM runs WHERE status IN ('queued','provisioning','running','waiting_for_input','persisting')) AS active`,
      )
    ).rows[0];
    current.push(metric('projects_active', counts.projects), metric('runs_active', counts.active));
  }
  const grouped: Metric[] = [];
  const group = query.get('group_by');
  let groupsTruncated = false;
  if (group) {
    const columns: Record<string, { runs: string; usage: string }> = {
      day: {
        runs: `to_char(date_trunc('day',created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD')`,
        usage: `to_char(date_trunc('day',u.created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD')`,
      },
      hour: {
        runs: `to_char(date_trunc('hour',created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:00:00"Z"')`,
        usage: `to_char(date_trunc('hour',u.created_at AT TIME ZONE 'UTC'),'YYYY-MM-DD"T"HH24:00:00"Z"')`,
      },
      organization: { runs: 'organization_id::text', usage: 'u.organization_id::text' },
      model: { runs: admin ? 'model' : `config->>'model'`, usage: 'u.model' },
      provider: { runs: admin ? 'provider' : `config->'rate_card'->>'provider'`, usage: 'u.provider' },
      harness: {
        runs: admin ? 'harness' : `config->>'harness'`,
        usage: admin ? 'r.harness' : `r.config->>'harness'`,
      },
      billing_mode: { runs: admin ? 'billing_mode' : `config->>'billing_mode'`, usage: 'u.billing_mode' },
    };
    const dimension = columns[group];
    assert(dimension, 400, 'invalid_request', 'This reporting dimension is unsupported.');
    const runGroups = (
      await tx.query(
        `SELECT COALESCE(${dimension.runs},'unknown') AS dimension,count(*)::text AS count,COALESCE(sum(cost_micro_usd),0)::text AS cost FROM ${source} WHERE created_at>=$1 AND created_at<$2${condition} GROUP BY 1 ORDER BY 1 LIMIT 1001`,
        args,
      )
    ).rows;
    const tokenGroups = (
      await tx.query(
        `SELECT COALESCE(${dimension.usage},'unknown') AS dimension,sum(u.input_tokens)::text AS input,sum(u.output_tokens)::text AS output,count(*) FILTER(WHERE u.completeness!='complete')::text AS missing FROM ${usage} u LEFT JOIN ${source} r ON r.id=u.run_id WHERE u.created_at>=$1 AND u.created_at<$2${organization ? ' AND u.organization_id=$3::uuid' : ''} GROUP BY 1 ORDER BY 1 LIMIT 1001`,
        args,
      )
    ).rows;
    groupsTruncated = runGroups.length > 1000 || tokenGroups.length > 1000;
    for (const row of runGroups.slice(0, 1000))
      for (const [name, value, unit] of [
        ['runs', row.count, 'count'],
        ['cost_micro_usd', row.cost, 'micro_usd'],
      ])
        grouped.push({ ...metric(name, value, unit), dimensions: { [group]: row.dimension } });
    for (const row of tokenGroups.slice(0, 1000))
      for (const [name, value] of [
        ['input_tokens', row.input],
        ['output_tokens', row.output],
      ])
        grouped.push({
          ...metric(name, value, 'tokens', Number(row.missing) ? 'missing' : 'known'),
          dimensions: { [group]: row.dimension },
        });
  }
  return report(
    query,
    [
      ...current,
      metric('requests', requestCount.count),
      metric('request_errors', requestCount.errors),
      metric('requests_incomplete', requestCount.incomplete),
      metric('runs', runs.total),
      metric('runs_succeeded', runs.succeeded),
      metric('runs_failed', runs.failed),
      metric('cost_micro_usd', runs.cost, 'micro_usd'),
      metric(
        'input_tokens',
        tokens.input ?? (tokens.count === '0' ? '0' : null),
        'tokens',
        Number(tokens.missing) ? 'missing' : 'known',
      ),
      metric(
        'output_tokens',
        tokens.output ?? (tokens.count === '0' ? '0' : null),
        'tokens',
        Number(tokens.missing) ? 'missing' : 'known',
      ),
      metric(
        'run_duration_p95_seconds',
        runs.duration_p95,
        'seconds',
        runs.duration_p95 === null ? 'insufficient_data' : 'known',
      ),
      ...grouped,
    ],
    [
      ...(Number(tokens.missing) ? ['provider_usage'] : []),
      ...(groupsTruncated ? ['group_limit'] : []),
      ...(Date.parse(dates.from) < Date.now() - 400 * 86400000 ? ['request_retention'] : []),
    ],
    {
      ...(organization ? { organization_id: organization } : {}),
      execution_provider: config.execution,
      ...(group ? { group_by: group, group_limit: 1000, groups_truncated: groupsTruncated } : {}),
    },
  );
}
export async function billing(tx: Tx, org: string) {
  const row = (await tx.query('SELECT * FROM organizations WHERE id=$1', [org])).rows[0];
  assert(row, 404, 'not_found', 'Organization not found.');
  // Reports, including the operator MCP, are read-only. Account for pending expiration
  // in the displayed spendable amount; admission/maintenance append the actual journals.
  const expired = BigInt(
    (
      await tx.query(
        'SELECT coalesce(sum(remaining_micro_usd),0)::text AS value FROM credit_lots WHERE expires_at<=now()',
      )
    ).rows[0].value,
  );
  const protectedCredit = BigInt(row.reserved_micro_usd);
  const effectiveBalance =
    BigInt(row.balance_micro_usd) - (expired > protectedCredit ? expired - protectedCredit : 0n);
  return {
    plan: row.plan,
    execution_policy: executionPolicy(row),
    plans: plans(),
    available_micro_usd: (effectiveBalance > BigInt(row.reserved_micro_usd)
      ? effectiveBalance - BigInt(row.reserved_micro_usd)
      : 0n
    ).toString(),
    outstanding_micro_usd: row.credit_debt_micro_usd,
    billing_hold: Boolean(
      row.settings.billing_hold || row.settings.payment_dispute_hold || row.settings.reconciliation_hold,
    ),
    billing_status: row.settings.reconciliation_hold
      ? 'reconciliation_review'
      : row.settings.payment_dispute_hold
        ? 'dispute_review'
        : row.settings.billing_status || 'current',
    subscription_price_micro_usd: planFor(row.plan).monthly_price_micro_usd,
    credit_lots: (
      await tx.query(
        'SELECT id,kind,remaining_micro_usd,expires_at FROM credit_lots WHERE remaining_micro_usd>0 ORDER BY expires_at NULLS LAST,created_at LIMIT 100',
      )
    ).rows.map((lot) => ({ ...lot, expires_at: lot.expires_at?.toISOString() || null })),
    reserved_micro_usd: row.reserved_micro_usd,
    rate_card_version: process.env.RATE_CARD_VERSION || '2026-09-v1',
    currency: 'USD',
    concurrency_limit: executionPolicy(row).concurrency_limit,
    storage_allowance_bytes: String(planFor(row.plan).storage_gib * 1024 ** 3),
  };
}
export async function requests(tx: Tx, query: URLSearchParams, org?: string) {
  const { from, to } = period(query);
  const args: unknown[] = [from, to];
  let where = 'created_at>=$1 AND created_at<$2';
  for (const [value, column] of [
    [org, 'organization_id'],
    [query.get('status_code'), 'status'],
    [query.get('route'), 'route'],
  ] as const)
    if (value) {
      args.push(value);
      where += ` AND ${column}=$${args.length}`;
    }
  if (query.get('cursor')) {
    args.push(query.get('cursor'));
    where += ` AND request_id<$${args.length}::uuid`;
  }
  const limit = Math.min(100, Number(query.get('limit')) || 25);
  args.push(limit + 1);
  const rows = (
    await tx.query(
      `SELECT * FROM api_requests WHERE ${where} ORDER BY request_id DESC LIMIT $${args.length}`,
      args,
    )
  ).rows;
  return {
    data: rows.slice(0, limit).map((r) => ({
      request_id: r.request_id,
      organization_id: r.organization_id || undefined,
      principal_id: r.principal_id || undefined,
      principal_type: r.principal_type || 'anonymous',
      started_at: r.created_at,
      method: r.method,
      route: r.route,
      status_code: r.status || undefined,
      duration_ms: r.duration_ms || 0,
      client_type: r.client_type,
    })),
    next_cursor: rows.length > limit ? rows[limit - 1].request_id : null,
  };
}
export async function adminReport(
  operation: string,
  p: Principal,
  query: URLSearchParams,
  params: Record<string, string> = {},
) {
  assert(p.operator, 403, 'forbidden', 'Operator access is required.');
  const org = query.get('organization_id') || undefined;
  return transaction(null, async (tx) => {
    await tx.query("SET LOCAL statement_timeout='30s'");
    if (operation === 'listReportSnapshots') {
      const { from, to } = period(query),
        limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 25));
      const rows = (
        await tx.query(
          'SELECT day::text,observed_at,report FROM report_snapshots WHERE day>=$1::date AND day<$2::date AND ($3::date IS NULL OR day<$3::date) ORDER BY day DESC LIMIT $4',
          [from, to, query.get('cursor'), limit + 1],
        )
      ).rows;
      return { data: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1].day : null };
    }
    if (operation === 'getPlatformUsageMetrics') return usageReport(tx, query, true, org);
    if (operation === 'listPlatformRequests') return requests(tx, query, org);
    if (operation === 'listAccounts' || operation === 'getAccountSummary') {
      const pii = query.get('include_contact') === 'true';
      if (pii) requireScopes(p, ['accounts:pii:read']);
      const limit = Math.min(100, Number(query.get('limit')) || 25);
      const args: unknown[] = [];
      const conditions = ['true'];
      if (params.account_id) {
        args.push(params.account_id);
        conditions.push(`id=$${args.length}::uuid`);
      }
      if (query.get('query')) {
        args.push(`%${query.get('query')}%`);
        conditions.push(`(name ILIKE $${args.length} OR id::text ILIKE $${args.length})`);
      }
      if (query.get('cursor')) {
        args.push(query.get('cursor'));
        conditions.push(`id<$${args.length}::uuid`);
      }
      args.push(limit + 1);
      const accounts = (
        await tx.query(
          `SELECT id,name,created_at,plan,member_count FROM reporting.accounts WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT $${args.length}`,
          args,
        )
      ).rows;
      if (pii)
        for (const a of accounts) {
          const contact = await tx.query(
            'SELECT u.email FROM memberships m JOIN auth."user" u ON u.id=m.user_id WHERE organization_id=$1 AND role=\'owner\' LIMIT 1',
            [a.id],
          );
          if (contact.rows[0]) a.contact_email = contact.rows[0].email;
        }
      if (operation === 'getAccountSummary') {
        assert(accounts[0], 404, 'not_found', 'Account not found.');
        // Reuse this transaction under the authorized account's RLS context. Nested pool
        // transactions could deadlock when every report already owns one connection.
        await tx.query("SELECT set_config('app.organization_id',$1,true)", [accounts[0].id]);
        await tx.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [
          'storage:' + accounts[0].id,
        ]);
        return {
          account: accounts[0],
          billing: await billing(tx, accounts[0].id),
          usage: await usageReport(tx, query, true, accounts[0].id),
          health: [],
        };
      }
      return {
        data: accounts.slice(0, limit),
        next_cursor: accounts.length > limit ? accounts[limit - 1].id : null,
      };
    }
    if (operation === 'getRunDiagnostics') {
      const row = (await tx.query('SELECT * FROM reporting.runs WHERE id=$1', [params.run_id])).rows[0];
      assert(row, 404, 'not_found', 'Run not found.');
      return {
        run_id: row.id,
        status: row.status,
        observed_at: new Date().toISOString(),
        lease_status:
          row.heartbeat_at && Date.now() - new Date(row.heartbeat_at).getTime() < 90000
            ? 'fresh'
            : 'inactive',
        checkpoint_status: row.persistence_status || 'pending',
        error_codes: row.failure_code ? [row.failure_code] : [],
      };
    }
    if (operation === 'getGrowthMetrics') {
      const { from, to } = period(query);
      return report(
        query,
        await growthMetrics(tx, from, to, org),
        Date.parse(to) - 30 * 86400000 < Date.now() - 400 * 86400000 ? ['activity_retention'] : [],
        {
          qualified_activity:
            'Successful authenticated human product mutations; polling and service keys excluded.',
          activation:
            'First succeeded non-simulator run; cohorts use account creation with complete 7/14-day observation windows.',
          acquisition:
            'UTC dates. Humans belong to a current included account; historical counts can change after membership removal.',
          exclusions: 'Organizations with settings.analytics_excluded=true; configure with operator SQL.',
          active_windows: 'Rolling 1, 7 and 30 days ending at to, independent of from.',
          ...(org ? { organization_id: org } : {}),
        },
      );
    }
    const states = (
      await tx.query('SELECT status,count(*)::text AS count FROM reporting.runs GROUP BY status')
    ).rows;
    const errors = readinessErrors();
    const pausedModels = (
      await tx.query(
        'SELECT count(*)::text AS count FROM provider_circuit_breakers WHERE resolved_at IS NULL',
      )
    ).rows[0].count;
    const queue = (
      await tx.query(
        "SELECT count(*)::text AS pending,coalesce(max(extract(epoch FROM now()-available_at)),0)::text AS oldest_seconds,count(*) FILTER(WHERE attempts>=8)::text AS exhausted FROM dispatch_jobs WHERE state<>'done' AND available_at<=now()",
      )
    ).rows[0];
    const finance = (
      await tx.query(
        "SELECT count(*) FILTER(WHERE financial->>'status'='attention')::text AS attention,count(*) FILTER(WHERE observed_at<now()-interval '2 hours')::text AS stale FROM reporting.maintenance",
      )
    ).rows[0];
    const unobserved = (
      await tx.query(
        'SELECT count(*)::text AS count FROM organizations o WHERE NOT EXISTS(SELECT 1 FROM reporting.maintenance m WHERE m.organization_id=o.id)',
      )
    ).rows[0].count;
    const connections = (
      await tx.query('SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname=current_database()')
    ).rows[0].count;
    const storageHealth = (
      await tx.query(
        "SELECT count(*) FILTER(WHERE health_code IS NOT NULL)::text AS attention,count(*) FILTER(WHERE observed_at IS NULL OR observed_at<now()-interval '2 hours')::text AS stale FROM reporting.storage",
      )
    ).rows[0];
    const incomplete = (
      await tx.query(
        "SELECT count(*)::text AS n FROM api_requests WHERE status IS NULL AND created_at<now()-interval '5 minutes' AND created_at>now()-interval '1 day'",
      )
    ).rows[0].n;
    const { from: schedulingFrom, to: schedulingTo } = period(query);
    const scheduling = await schedulingReport(tx, schedulingFrom, schedulingTo, org);
    const metrics = [
      metric('active_executions', scheduling.active_executions),
      metric('global_concurrency_limit', scheduling.global_concurrency_limit),
      metric('eligible_queued_jobs', scheduling.eligible_queued_jobs),
      metric('oldest_eligible_wait_seconds', scheduling.oldest_eligible_wait_seconds, 'seconds'),
      metric('submission_to_start_mean_seconds', scheduling.mean_start_wait_seconds, 'seconds'),
      metric('submission_to_start_p95_seconds', scheduling.p95_start_wait_seconds, 'seconds'),
      metric('storage_maintenance_attention', storageHealth.attention),
      metric(
        'storage_measurements_stale',
        String(
          Number(storageHealth.stale) +
            Number(
              (
                await tx.query(
                  'SELECT count(*)::text AS n FROM organizations o WHERE NOT EXISTS(SELECT 1 FROM reporting.storage s WHERE s.organization_id=o.id)',
                )
              ).rows[0].n,
            ),
        ),
      ),
      metric('request_observations_incomplete_24h', incomplete),
      metric('database_available', 1, 'boolean'),
      ...states.map((r) => metric(`runs_${r.status}`, r.count)),
      metric('configuration_errors', errors.length),
      metric('provider_circuit_breakers', pausedModels),
      metric('execution_enabled', realExecutionEnabled() ? 1 : 0, 'boolean'),
      metric('dispatch_pending', queue.pending),
      metric('dispatch_oldest_due_seconds', queue.oldest_seconds, 'seconds'),
      metric('dispatch_exhausted', queue.exhausted),
      metric('financial_reconciliation_attention', finance.attention),
      metric('financial_reconciliation_stale', String(Number(finance.stale) + Number(unobserved))),
      metric('database_connections', connections),
    ];
    if (operation === 'getCapacityReport')
      metrics.push(metric('provider_capacity', null, 'concurrent_sandboxes', 'missing'));
    if (operation === 'getOperatingReport') {
      const usage = await usageReport(tx, query, true);
      metrics.push(...usage.metrics);
    }
    const recommendations = errors.map((message, i) => ({
      code: `configuration_${i}`,
      summary: message,
      evidence_metric_names: ['configuration_errors'],
      suggested_action: 'Complete the corresponding launch-guide configuration step.',
      action_executed: false as const,
    }));
    if (scheduling.oldest_eligible_wait_seconds > 120)
      recommendations.push({
        code: 'execution_queue_delay',
        summary: 'Eligible customer work has waited more than two minutes.',
        evidence_metric_names: [
          'oldest_eligible_wait_seconds',
          'active_executions',
          'global_concurrency_limit',
        ],
        suggested_action:
          'Compare waits by organization, inspect dispatch and database pressure, verify sandbox/model quotas, then progressively raise the execution ceiling if capacity permits. Preserve running agents.',
        action_executed: false,
      });
    if (Number(queue.oldest_seconds) > 120)
      recommendations.push({
        code: 'queue_delay',
        summary: 'Due work has waited more than two minutes.',
        evidence_metric_names: ['dispatch_oldest_due_seconds', 'dispatch_pending'],
        suggested_action:
          'Inspect blocked jobs, database saturation and provider limits. Increase dispatch capacity only after identifying the bottleneck.',
        action_executed: false,
      });
    if (Number(finance.attention) > 0)
      recommendations.push({
        code: 'financial_reconciliation',
        summary: 'One or more accounts have inconsistent financial projections.',
        evidence_metric_names: ['financial_reconciliation_attention'],
        suggested_action:
          'Inspect the reconciliation evidence and payment receipts. Keep new spending blocked until the discrepancy is resolved.',
        action_executed: false,
      });
    return {
      ...report(query, metrics, ['live_provider_telemetry'], { environment: config.mode }),
      recommendations,
      scheduling,
    };
  });
}
