import type { components } from '../../contracts/api';
import type { Tx } from '../../db';
import { requireScopes, type Principal } from './auth';
import { assert } from './errors';
import { canonical, id, seal, sha256, unseal } from './crypto';
import * as resources from './resources';
import { assertConnectionOwner, connectionTools } from './connections';
import {
  isToolConnection,
  toolConnectionKinds,
  ruleInput,
  type AccessContext,
  type AccessRule,
} from './connection-access-policy';

type Schema = components['schemas'];
export type Connection = resources.Document<'connections'>;
type RuleRow = Omit<Schema['ConnectionAccessRule'], 'created_at' | 'updated_at'> & {
  created_at: Date;
  updated_at: Date;
  sort_key?: string;
};
const joins = `LEFT JOIN projects rp ON rp.organization_id=r.organization_id AND rp.id=r.project_id
 LEFT JOIN agents ra ON ra.organization_id=r.organization_id AND ra.id=r.agent_id`;
const active = `(r.project_id IS NULL OR (rp.id IS NOT NULL AND COALESCE(rp.data->>'deleted','false')<>'true'))
 AND (r.agent_id IS NULL OR (ra.id IS NOT NULL AND COALESCE(ra.data->>'deleted','false')<>'true'))`;
const ruleFields = `r.id,r.connection_id,r.scope,r.project_id,r.agent_id,r.created_at,r.updated_at,
 CASE WHEN COALESCE(rp.data->>'deleted','false')<>'true' THEN rp.data->>'name' END AS project_name,
 CASE WHEN COALESCE(ra.data->>'deleted','false')<>'true' THEN ra.data->>'name' END AS agent_name,
 NOT (${active}) AS unavailable`;
const presentRule = (r: RuleRow): Schema['ConnectionAccessRule'] => ({
  id: r.id,
  connection_id: r.connection_id,
  scope: r.scope,
  project_id: r.project_id,
  agent_id: r.agent_id,
  project_name: r.project_name,
  agent_name: r.agent_name,
  unavailable: r.unavailable,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
});
export class AccessParameters {
  values: unknown[] = [];
  add(value: unknown) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}
/** SQL counterpart of ruleMatches. The full pair stays in one EXISTS row. */
function matchingRules(
  p: Principal,
  context: AccessContext,
  args: AccessParameters,
  includeUnavailable = false,
) {
  const conditions = includeUnavailable ? [] : [active];
  if (p.projectIds.length)
    conditions.push(`(r.project_id IS NULL OR r.project_id=ANY(${args.add(p.projectIds)}::uuid[]))`);
  if (context.project_id !== undefined)
    conditions.push(`(r.project_id IS NULL OR r.project_id=${args.add(context.project_id)}::uuid)`);
  if (context.agent_id !== undefined)
    conditions.push(
      context.agent_id === null
        ? 'r.agent_id IS NULL'
        : `(r.agent_id IS NULL OR r.agent_id=${args.add(context.agent_id)}::uuid)`,
    );
  return conditions.join(' AND ') || 'true';
}
/** Persistent eligibility for an outer connections row aliased as c. */
export function connectionAccessPredicate(p: Principal, context: AccessContext, args: AccessParameters) {
  const match = matchingRules(p, context, args);
  return `(c.access_organization_wide OR EXISTS(SELECT 1 FROM connection_access_rules r ${joins} WHERE r.connection_id=c.id AND ${match}))`;
}
export async function authorizeContext(tx: Tx, p: Principal, context: AccessContext) {
  if (context.project_id) await resources.get(tx, 'projects', context.project_id, p);
  if (context.agent_id) await resources.get(tx, 'agents', context.agent_id, p);
}
export function contextQuery(query: URLSearchParams): AccessContext {
  return {
    ...(query.has('project_id') ? { project_id: query.get('project_id')! } : {}),
    ...(query.has('agent_id') ? { agent_id: query.get('agent_id')! } : {}),
  };
}
function pageState(p: Principal, query: URLSearchParams, binding: unknown) {
  const limit = Number(query.get('limit') || 25);
  assert(
    Number.isInteger(limit) && limit >= 1 && limit <= 100,
    400,
    'invalid_limit',
    'Use a page size between 1 and 100.',
  );
  const fingerprint = sha256(
    canonical({ organization: p.organizationId, user: p.userId, projects: p.projectIds, binding }),
  );
  let after: { id: string; key: string } | undefined;
  if (query.get('cursor')) {
    try {
      const value = unseal<{ fingerprint: string; id: string; key: string }>(query.get('cursor')!);
      assert(
        value.fingerprint === fingerprint && typeof value.id === 'string' && typeof value.key === 'string',
        400,
        'invalid_cursor',
        'This cursor belongs to different filters.',
      );
      after = value;
    } catch {
      assert(false, 400, 'invalid_cursor', 'This cursor is invalid or belongs to different filters.');
    }
  }
  return {
    limit,
    after,
    cursor: (item: { id: string; key?: string }) => seal({ fingerprint, id: item.id, key: item.key || '' }),
  };
}
export { pageState as accessPageState };
export function safeConnection(c: Connection, p: Principal): Schema['Connection'] {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    provider: c.provider,
    auth_method: c.auth_method,
    status: c.status,
    created_at: c.created_at,
    owner_subject_id: c.owner_subject_id,
    last_checked_at: c.last_checked_at,
    ...(c.owner_subject_id === p.userId
      ? {
          url: c.url,
          package: c.package,
          package_version: c.package_version,
          account_identity: c.account_identity,
          api_fallback: c.api_fallback,
          availability: c.availability,
        }
      : {}),
  };
}
function assertAccessOwner(p: Principal, connection: Connection) {
  assertConnectionOwner(p, connection);
  assert(
    isToolConnection(connection.kind),
    400,
    'connection_access_unsupported',
    'This connection uses its existing model or subscription authorization.',
  );
}
function assertAccessVersion(connection: Connection, expected: string) {
  assert(
    expected === `"${connection.access_version}"`,
    412,
    'stale_revision',
    'Connection access changed. Review the current settings before saving again.',
  );
}
export async function ownedAccess(tx: Tx, p: Principal, connectionId: string) {
  requireScopes(p, ['connections:read']);
  const connection = await resources.get(tx, 'connections', connectionId, p);
  assertAccessOwner(p, connection);
  return connection;
}
export async function accessSummary(
  tx: Tx,
  p: Principal,
  c: Connection,
): Promise<Schema['ConnectionAccess']> {
  const args = new AccessParameters();
  const connection = args.add(c.id);
  const visible = matchingRules(p, {}, args, true);
  const count = (
    await tx.query<{ count: string }>(
      `SELECT count(*) FROM connection_access_rules r ${joins} WHERE r.connection_id=${connection} AND ${visible}`,
      args.values,
    )
  ).rows[0];
  return {
    connection_id: c.id,
    version: c.access_version,
    organization_wide: c.access_organization_wide,
    tools: c.access_tools,
    rule_count: Number(count.count),
    can_grant:
      c.owner_subject_id === p.userId &&
      p.scopes.includes('connections:write') &&
      ['owner', 'admin'].includes(p.role),
    can_revoke:
      c.owner_subject_id === p.userId && p.scopes.includes('connections:write') && p.role !== 'viewer',
  };
}
function requireGrant(p: Principal, unrestricted = false) {
  assert(
    ['owner', 'admin'].includes(p.role),
    403,
    'organization_admin_required',
    'Only an owning organization administrator can expand access.',
  );
  if (unrestricted)
    assert(
      !p.projectIds.length,
      403,
      'forbidden',
      'Organization and agent permissions require unrestricted project authority.',
    );
}
async function lockAccess(tx: Tx, p: Principal, connectionId: string, expected: string) {
  requireScopes(p, ['connections:write']);
  await tx.query('SELECT id FROM connections WHERE id=$1 FOR UPDATE', [connectionId]);
  const c = await resources.get(tx, 'connections', connectionId, p);
  assertAccessOwner(p, c);
  assertAccessVersion(c, expected);
  return c;
}
async function changed(
  tx: Tx,
  p: Principal,
  c: Connection,
  action: string,
  details: Record<string, unknown>,
) {
  const { rows } = await tx.query<{ access_version: string }>(
    'UPDATE connections SET access_version=access_version+1,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING access_version',
    [c.id],
  );
  await tx.query(
    'INSERT INTO organization_audit(id,organization_id,actor_id,action,subject_id,data) VALUES($1,$2,$3,$4,$5,$6)',
    [
      id(),
      p.organizationId,
      p.userId!,
      action,
      c.id,
      JSON.stringify({ ...details, version: rows[0].access_version }),
    ],
  );
  return rows[0].access_version;
}
export async function patchAccess(
  tx: Tx,
  p: Principal,
  connectionId: string,
  patch: Schema['ConnectionAccessPatch'],
  expected: string,
) {
  // Discovery can rotate OAuth credentials independently. Never hold the parent lock here.
  requireScopes(p, ['connections:write']);
  const before = await resources.get(tx, 'connections', connectionId, p);
  assertAccessOwner(p, before);
  assertAccessVersion(before, expected);
  const additions = patch.tools?.filter((tool) => !before.access_tools.includes(tool)) || [];
  if (additions.length) requireGrant(p);
  const catalog = additions.length ? await connectionTools(before) : [];
  const c = await lockAccess(tx, p, connectionId, expected);
  if (patch.organization_wide === true && !c.access_organization_wide) requireGrant(p, true);
  if (additions.length) {
    assert(
      additions.every((name) => catalog.some((tool) => tool.name === name)),
      400,
      'unknown_tool',
      'An approved tool must exist in the current catalog.',
    );
  }
  await tx.query('UPDATE connections SET access_organization_wide=$2,access_tools=$3 WHERE id=$1', [
    c.id,
    patch.organization_wide ?? c.access_organization_wide,
    patch.tools ?? c.access_tools,
  ]);
  await changed(tx, p, c, 'connection.access.updated', {
    organization_wide: patch.organization_wide,
    tools: patch.tools,
  });
  return accessSummary(tx, p, await resources.get(tx, 'connections', c.id));
}
async function validateRule(tx: Tx, p: Principal, rule: AccessRule) {
  requireGrant(p, rule.scope === 'agent');
  await authorizeContext(tx, p, rule);
}
export async function listRules(
  tx: Tx,
  p: Principal,
  connectionId: string,
  query: URLSearchParams,
): Promise<Schema['ConnectionAccessRulePage']> {
  const c = await ownedAccess(tx, p, connectionId);
  const context = contextQuery(query);
  await authorizeContext(tx, p, context);
  const sort = query.get('sort') || 'created_at',
    direction = query.get('direction') || 'asc';
  assert(
    ['project', 'agent', 'created_at'].includes(sort) && ['asc', 'desc'].includes(direction),
    400,
    'invalid_sort',
    'Choose a supported permission sort.',
  );
  const state = pageState(p, query, { kind: 'rules', connectionId, context, sort, direction });
  const args = new AccessParameters(),
    conditions = [`r.connection_id=${args.add(c.id)}`, matchingRules(p, {}, args, true)];
  // Rule filters address the actual target columns, not effective OR policy.
  if (context.project_id) conditions.push(`r.project_id=${args.add(context.project_id)}::uuid`);
  if (context.agent_id) conditions.push(`r.agent_id=${args.add(context.agent_id)}::uuid`);
  const key =
    sort === 'created_at'
      ? 'r.created_at::text'
      : `COALESCE(lower(${sort === 'project' ? 'rp' : 'ra'}.data->>'name'),'')`;
  if (state.after)
    conditions.push(
      `(${key},r.id) ${direction === 'asc' ? '>' : '<'} (${args.add(state.after.key)},${args.add(state.after.id)}::uuid)`,
    );
  const rows = (
    await tx.query<RuleRow>(
      `SELECT ${ruleFields},${key} AS sort_key FROM connection_access_rules r ${joins} WHERE ${conditions.join(' AND ')} ORDER BY ${key} ${direction},r.id ${direction} LIMIT ${args.add(state.limit + 1)}`,
      args.values,
    )
  ).rows;
  return {
    data: rows.slice(0, state.limit).map(presentRule),
    next_cursor:
      rows.length > state.limit
        ? state.cursor({ id: rows[state.limit - 1].id, key: rows[state.limit - 1].sort_key })
        : null,
    version: c.access_version,
  };
}
async function getRule(tx: Tx, p: Principal, connectionId: string, ruleId: string) {
  const args = new AccessParameters();
  const conditions = [
    `r.connection_id=${args.add(connectionId)}`,
    `r.id=${args.add(ruleId)}`,
    matchingRules(p, {}, args, true),
  ];
  const row = (
    await tx.query<RuleRow>(
      `SELECT ${ruleFields} FROM connection_access_rules r ${joins} WHERE ${conditions.join(' AND ')}`,
      args.values,
    )
  ).rows[0];
  assert(row, 404, 'not_found', 'Permission not found.');
  return row;
}
export async function saveRule(
  tx: Tx,
  p: Principal,
  connectionId: string,
  input: AccessRule,
  expected: string,
  ruleId?: string,
): Promise<Schema['ConnectionAccessRuleMutation']> {
  const c = await lockAccess(tx, p, connectionId, expected);
  if (ruleId) await getRule(tx, p, connectionId, ruleId);
  await validateRule(tx, p, input);
  const project = 'project_id' in input ? input.project_id : null,
    agent = 'agent_id' in input ? input.agent_id : null;
  const duplicate = (
    await tx.query<{ id: string }>(
      `SELECT id FROM connection_access_rules WHERE connection_id=$1 AND scope=$2 AND project_id IS NOT DISTINCT FROM $3::uuid AND agent_id IS NOT DISTINCT FROM $4::uuid AND ($5::uuid IS NULL OR id<>$5)`,
      [c.id, input.scope, project, agent, ruleId || null],
    )
  ).rows[0];
  assert(
    !duplicate,
    409,
    'duplicate_permission',
    'This permission already exists.',
    duplicate ? { rule_id: duplicate.id } : undefined,
  );
  const savedId = ruleId || id();
  if (ruleId)
    await tx.query(
      'UPDATE connection_access_rules SET scope=$2,project_id=$3,agent_id=$4,updated_at=now() WHERE id=$1',
      [ruleId, input.scope, project, agent],
    );
  else
    await tx.query(
      'INSERT INTO connection_access_rules(id,organization_id,connection_id,scope,project_id,agent_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [savedId, p.organizationId, c.id, input.scope, project, agent, p.userId],
    );
  const version = await changed(
    tx,
    p,
    c,
    ruleId ? 'connection.permission.updated' : 'connection.permission.created',
    { rule_id: savedId, ...input },
  );
  return { rule: presentRule(await getRule(tx, p, c.id, savedId)), version };
}
export async function deleteRule(
  tx: Tx,
  p: Principal,
  connectionId: string,
  ruleId: string,
  expected: string,
): Promise<Schema['ConnectionAccessRuleDeleted']> {
  const c = await lockAccess(tx, p, connectionId, expected);
  const rule = await getRule(tx, p, c.id, ruleId);
  await tx.query('DELETE FROM connection_access_rules WHERE id=$1', [ruleId]);
  return {
    id: ruleId,
    version: await changed(tx, p, c, 'connection.permission.deleted', {
      rule_id: ruleId,
      ...ruleInput(rule),
    }),
  };
}

/** Bounded explanations for a bounded connection page, in one query regardless of rule count. */
export async function accessMatchesFor(
  tx: Tx,
  p: Principal,
  connections: Connection[],
  context: AccessContext,
): Promise<Map<string, Schema['ConnectionAccessMatch']>> {
  const result = new Map<string, Schema['ConnectionAccessMatch']>();
  if (!connections.length) return result;
  const args = new AccessParameters();
  const ids = args.add(connections.map((c) => c.id));
  const match = matchingRules(p, context, args);
  const conditional = `(${context.project_id === undefined ? 'r.project_id IS NOT NULL' : 'false'} OR ${context.agent_id === undefined ? 'r.agent_id IS NOT NULL' : 'false'})`;
  const rows = (
    await tx.query<RuleRow & { total: string; all_conditional: boolean; sample_rank: string }>(
      `WITH matched AS (
 SELECT ${ruleFields},count(*) OVER(PARTITION BY r.connection_id) AS total,
 bool_and(${conditional}) OVER(PARTITION BY r.connection_id) AS all_conditional,
 row_number() OVER(PARTITION BY r.connection_id,r.scope ORDER BY r.id) AS scope_rank,
 CASE r.scope WHEN 'project_agent' THEN 0 WHEN 'project' THEN 1 ELSE 2 END AS priority
 FROM connection_access_rules r ${joins} WHERE r.connection_id=ANY(${ids}::uuid[]) AND ${match}
 ), ranked AS (SELECT *,row_number() OVER(PARTITION BY connection_id ORDER BY (scope_rank=1) DESC,priority,id) AS sample_rank FROM matched)
 SELECT * FROM ranked WHERE sample_rank<=3 ORDER BY connection_id,sample_rank`,
      args.values,
    )
  ).rows;
  for (const c of connections) {
    const samples = rows.filter((r) => r.connection_id === c.id);
    const scopes: Schema['ConnectionAccessMatch']['scopes'] = samples
      .map((r) => r.scope)
      .filter((scope, index, all) => all.indexOf(scope) === index);
    if (c.access_organization_wide) scopes.push('organization');
    result.set(c.id, {
      scopes,
      conditional: !c.access_organization_wide && Boolean(samples[0]?.all_conditional),
      matched_rule_count: Number(samples[0]?.total || 0),
      matching_rules: samples.map((r) => ({
        rule_id: r.id,
        ...ruleInput(r),
        ...(r.project_name ? { project_name: r.project_name } : {}),
        ...(r.agent_name ? { agent_name: r.agent_name } : {}),
      })),
      matching_rules_truncated: Number(samples[0]?.total || 0) > samples.length,
    });
  }
  return result;
}
export async function listContextConnections(
  tx: Tx,
  p: Principal,
  query: URLSearchParams,
  context = contextQuery(query),
  binding: unknown = 'connections',
): Promise<Schema['ContextualConnectionPage']> {
  requireScopes(p, ['connections:read']);
  await authorizeContext(tx, p, context);
  const state = pageState(p, query, { kind: binding, context });
  const args = new AccessParameters(),
    conditions = ["COALESCE(c.data->>'deleted','false')<>'true'"];
  const hasContext = context.project_id !== undefined || context.agent_id !== undefined;
  const kinds = args.add(toolConnectionKinds);
  conditions.push(
    hasContext
      ? `(c.data->>'kind')=ANY(${kinds}::text[])`
      : `((c.data->>'kind')=ANY(${kinds}::text[]) OR c.data->>'owner_subject_id'=${args.add(p.userId)})`,
  );
  if (hasContext) {
    conditions.push(connectionAccessPredicate(p, context, args));
    // An omitted project means an authorized possible execution project must exist.
    if (!context.project_id)
      conditions.push(
        `EXISTS(SELECT 1 FROM projects px WHERE COALESCE(px.data->>'deleted','false')<>'true' ${p.projectIds.length ? `AND px.id=ANY(${args.add(p.projectIds)}::uuid[])` : ''})`,
      );
  }
  if (state.after) conditions.push(`c.id<${args.add(state.after.id)}::uuid`);
  const rows = (
    await tx.query(
      `SELECT c.* FROM connections c WHERE ${conditions.join(' AND ')} ORDER BY c.id DESC LIMIT ${args.add(state.limit + 1)}`,
      args.values,
    )
  ).rows;
  const selected = rows.slice(0, state.limit).map((row) => resources.present(row, 'connections'));
  const matches = await accessMatchesFor(tx, p, selected, context);
  return {
    data: selected.map((c) => ({
      ...safeConnection(c, p),
      ...(isToolConnection(c.kind) ? { approved_tools: c.access_tools } : {}),
      access_match: matches.get(c.id)!,
    })),
    next_cursor: rows.length > state.limit ? state.cursor({ id: selected.at(-1)!.id }) : null,
  };
}
export async function expandConnections<K extends 'projects' | 'agents'>(
  tx: Tx,
  p: Principal,
  table: K,
  resourceId: string,
  query: URLSearchParams,
) {
  const resource = await resources.get(tx, table, resourceId, p);
  const counterpart = table === 'projects' ? 'agent_id' : 'project_id';
  const include = query.get('include_connections') === 'true';
  assert(
    include || ![counterpart, 'connections_limit', 'connections_cursor'].some((name) => query.has(name)),
    400,
    'include_connections_required',
    'Connection filters and pagination require include_connections=true.',
  );
  if (!include) return resource;
  const page = new URLSearchParams();
  if (query.has('connections_limit')) page.set('limit', query.get('connections_limit')!);
  if (query.has('connections_cursor')) page.set('cursor', query.get('connections_cursor')!);
  const context: AccessContext = {
    ...contextQuery(query),
    [table === 'projects' ? 'project_id' : 'agent_id']: resourceId,
  };
  return {
    ...resource,
    connections: await listContextConnections(tx, p, page, context, { table, resourceId }),
  };
}
