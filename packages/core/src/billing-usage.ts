import type { Tx } from '../../db';
import type { components } from '../../contracts/api';
import { assert } from './errors';

type Entry = components['schemas']['BillingUsageEntry'];
type Page = components['schemas']['BillingUsagePage'];

/** Financial records only: never join transcript bodies, credentials or Langfuse.
 * Model/tool usage accrues during execution; the final journal supplies the
 * remaining compute charge. These are disjoint amounts, not duplicate run totals. */
export async function billingUsage(tx: Tx, organization: string, query: URLSearchParams): Promise<Page> {
  const from = query.get('from') || '',
    to = query.get('to') || '';
  assert(
    Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to)),
    400,
    'invalid_period',
    'Provide from and to timestamps with from before to.',
  );
  // Compare in PostgreSQL so sub-millisecond boundaries retain the same
  // precision as the accounting timestamps rather than being rounded by Date.
  const period = await tx.query<{ valid: boolean }>('SELECT $1::timestamptz < $2::timestamptz AS valid', [
    from,
    to,
  ]);
  assert(period.rows[0].valid, 400, 'invalid_period', 'Provide from before to.');
  const args: unknown[] = [organization, from, to];
  const bind = (value: unknown) => {
    args.push(value);
    return `$${args.length}`;
  };
  const runFilters = ['r.organization_id=$1'];
  for (const field of ['workspace_id', 'worktree_id', 'session_id'] as const) {
    const value = query.get(field);
    if (value) runFilters.push(`r.${field}=${bind(value)}::uuid`);
  }
  if (query.has('run_id')) runFilters.push(`r.id=${bind(query.get('run_id'))}::uuid`);
  for (const field of ['customer_id', 'agent_key'] as const)
    if (query.has(field)) runFilters.push(`b.${field}=${bind(query.get(field))}`);
  if (query.has('billing_mode'))
    runFilters.push(`r.config->>'billing_mode'=${bind(query.get('billing_mode'))}`);
  const sandboxFilters = ['s.organization_id=$1'];
  for (const field of ['workspace_id','worktree_id'] as const) {
    const value = query.get(field);
    if (value) sandboxFilters.push(`s.${field}=${bind(value)}::uuid`);
  }
  // Compute allocations can span several agents/sessions: do not attribute the whole server to one run.
  const includeSandboxes = !['session_id','run_id','customer_id','agent_key','billing_mode'].some(field => query.has(field));
  const entryFilters: string[] = [];
  for (const field of ['kind', 'provider', 'model'] as const)
    if (query.has(field)) entryFilters.push(`e.${field}=${bind(query.get(field))}`);
  if (query.has('cursor')) entryFilters.push(`e.id<${bind(query.get('cursor'))}::uuid`);
  const limit = Number(query.get('limit') || 25);
  const pageLimit = bind(limit + 1);
  // Organization storage has no run/workspace/customer attribution. A run filter
  // must not accidentally include all of the organization's storage charges.
  const includeStorage = runFilters.length === 1;
  const rows = await tx.query<{ entry: Entry }>(
    `WITH eligible_runs AS NOT MATERIALIZED (
      SELECT r.id,r.workspace_id,r.worktree_id,r.session_id,r.config->>'billing_mode' AS billing_mode,
        b.customer_id,b.agent_key
      FROM runs r LEFT JOIN customer_agent_bindings b ON b.organization_id=r.organization_id
        AND b.workspace_id=r.workspace_id AND b.worktree_id=r.worktree_id AND b.agent_id::text=r.config->>'agent_id'
        AND b.owner_user_id=r.config->>'user_id'
      WHERE ${runFilters.join(' AND ')}
    ), entries AS (
      SELECT u.id,u.created_at AS occurred_at,'model'::text AS kind,u.run_id,u.provider,u.model,
        CASE WHEN u.billing_mode='byok' THEN '0' ELSE u.cost_micro_usd::text END AS charged_micro_usd,
        jsonb_build_object('model_usage',jsonb_build_object(
          'request_id',u.request_id,'input_tokens',u.input_tokens::text,'output_tokens',u.output_tokens::text,
          'cached_input_tokens',CASE WHEN u.completeness='complete' THEN u.usage_details->>'cached_tokens' END,
          'cache_write_input_tokens',CASE WHEN u.completeness='complete' THEN u.usage_details->>'cache_write_tokens' END,
          'completeness',u.completeness,'provisional',coalesce((u.usage_details->>'provisional')::boolean,u.completeness<>'complete'),
          'bound_breached',coalesce((u.usage_details->>'bound_breached')::boolean,false),
          'budget_cost_micro_usd',u.cost_micro_usd::text,'reserved_micro_usd',g.reserved_micro_usd::text,
          'reported_micro_usd',u.usage_details->>'reported_micro_usd',
          'provider_cost_micro_usd',u.usage_details->>'provider_cost_micro_usd',
          'provider_cost_status',coalesce(u.usage_details->>'provider_cost_status','unavailable')
        )) AS detail
      FROM model_usage u JOIN eligible_runs r ON r.id=u.run_id
        LEFT JOIN gateway_requests g ON g.run_id=u.run_id AND g.id::text=u.request_id
      WHERE u.organization_id=$1 AND u.created_at>=$2 AND u.created_at<$3
      UNION ALL
      SELECT t.id,t.created_at,'tool',t.run_id,NULL,NULL,t.cost_micro_usd::text,
        jsonb_build_object('tool',jsonb_build_object('name',t.tool_name,'connection_id',t.connection_id,'status',t.status))
      FROM tool_invocations t JOIN eligible_runs r ON r.id=t.run_id
      WHERE t.organization_id=$1 AND t.created_at>=$2 AND t.created_at<$3
      UNION ALL
      SELECT l.id,l.created_at,'compute',r.id,NULL,NULL,
        (l.amount_micro_usd
          - coalesce((SELECT sum(u.cost_micro_usd) FROM model_usage u WHERE u.run_id=r.id AND u.billing_mode='managed'),0)
          - coalesce((SELECT sum(t.cost_micro_usd) FROM tool_invocations t WHERE t.run_id=r.id),0))::text,
        '{}'::jsonb
      FROM ledger l JOIN eligible_runs r ON l.reference='run:'||r.id::text
      WHERE l.organization_id=$1 AND l.account='consumption' AND l.created_at>=$2 AND l.created_at<$3
      UNION ALL
      SELECT l.id,l.created_at,'compute',NULL,s.provider,NULL,l.amount_micro_usd::text,
        jsonb_build_object('sandbox_id',s.id,'workspace_id',s.workspace_id,'worktree_id',s.worktree_id)
      FROM ledger l JOIN sandboxes s ON split_part(l.reference,':',2)=s.id::text AND l.reference LIKE 'sandbox:%'
      WHERE ${includeSandboxes ? 'true' : 'false'} AND ${sandboxFilters.join(' AND ')} AND l.organization_id=$1 AND l.account='consumption' AND l.created_at>=$2 AND l.created_at<$3
      UNION ALL
      SELECT s.id,s.observed_at,'storage',NULL,NULL,NULL,s.charged_micro_usd::text,
        jsonb_build_object('storage',jsonb_build_object('physical_bytes',s.physical_bytes::text,'object_count',s.object_count::text))
      FROM storage_usage s WHERE ${includeStorage ? 'true' : 'false'} AND s.organization_id=$1 AND s.observed_at>=$2 AND s.observed_at<$3
    )
    SELECT jsonb_build_object('id',e.id,'kind',e.kind,'occurred_at',e.occurred_at,
      'run_id',e.run_id,'workspace_id',r.workspace_id,'worktree_id',r.worktree_id,'session_id',r.session_id,
      'customer_id',r.customer_id,'agent_key',r.agent_key,'provider',e.provider,'model',e.model,
      'billing_mode',r.billing_mode,'charged_micro_usd',e.charged_micro_usd)||e.detail AS entry
    FROM entries e LEFT JOIN eligible_runs r ON r.id=e.run_id
    WHERE (e.kind<>'compute' OR e.charged_micro_usd::bigint>0)
      ${entryFilters.length ? `AND ${entryFilters.join(' AND ')}` : ''}
    ORDER BY e.id DESC LIMIT ${pageLimit}`,
    args,
  );
  return {
    from,
    to,
    currency: 'USD',
    data: rows.rows.slice(0, limit).map((row) => row.entry),
    next_cursor: rows.rows.length > limit ? rows.rows[limit - 1].entry.id : null,
  };
}
