import type { components } from '../../contracts/api';
import type { Tx } from '../../db';
import { requireScopes, type Principal } from './auth';
import { assert } from './errors';
import * as resources from './resources';
import { actorAuthorized } from './actor-authorization';
import type { NativeRunRow } from './runs';
import {
  guardedToolsRequired,
  permissionLayers,
  toolAllowed,
  type PermissionLayers,
} from '../../contracts/permissions';
import { validatePermissions } from './agent-permissions';
import {
  accessMatchesFor,
  accessPageState,
  AccessParameters,
  connectionAccessPredicate,
  type Connection,
} from './connection-access';
import {
  isToolConnection,
  toolConnectionKinds,
  selectedGrants,
  sourcePriority,
  type Grant,
  type AccessSource,
} from './connection-access-policy';

type Schema = components['schemas'];
export type ConnectionAccessSnapshot = {
  connection_id: string;
  access_version: string;
  source: AccessSource;
  rule_id?: string;
  owner_subject_id: string;
  external_account_id: string | null;
  override?: { tools: string[]; authorized_by: string };
};
export type ResolutionContext = {
  workspace_id: string;
  agent_id: string | null;
  worktree_id?: string;
  defaults?: Grant[];
  permissions: PermissionLayers;
};
const unavailable = (connection_id: string): Schema['ConnectionAccessResolution'] => ({
  connection_id,
  name: 'Unavailable connection',
  tools: [],
  source: 'none',
  ready: false,
  can_override: false,
  rejection_codes: ['connection_unavailable'],
  access_match: noMatch(),
});
const noMatch = (): Schema['ConnectionAccessMatch'] => ({
  scopes: [],
  conditional: false,
  matched_rule_count: 0,
  matching_rules: [],
  matching_rules_truncated: false,
});
// Bound native tool discovery/launch payloads, independently of the unlimited rule table.
export const MAX_RUN_CONNECTIONS = 100;
export const MAX_RUN_TOOLS = 256;
function selectionMap(grants: Grant[] | undefined) {
  return new Map((grants || []).map((g) => [g.connection_id, g.tools]));
}
async function liveOwners(tx: Tx, connections: Connection[]) {
  const rows = (
    await tx.query<{ user_id: string }>(
      'SELECT user_id FROM memberships WHERE user_id=ANY($1::text[]) AND organization_id=$2',
      [connections.map((c) => c.owner_subject_id), connections[0]?.organization_id || null],
    )
  ).rows;
  return new Set(rows.map((row) => row.user_id));
}
function readiness(c: Connection, member: boolean, layers: PermissionLayers): string[] {
  const codes: string[] = [];
  if (!isToolConnection(c.kind)) codes.push('connection_access_unsupported');
  if (c.deleted || c.status !== 'healthy') codes.push('connection_unavailable');
  if (!member) codes.push('connection_owner_unavailable');
  if (c.kind === 'composio' && (!c.external_account_id || !c.identity_verified))
    codes.push('authorization_required');
  if (c.kind === 'mcp_stdio' && guardedToolsRequired(layers)) codes.push('permissions_unsupported');
  return codes;
}
/** Purely persisted state: preview/admission do not discover tools or call providers. */
async function resolveRows(
  tx: Tx,
  p: Principal,
  context: ResolutionContext,
  rows: Connection[],
  selection: Grant[] | undefined,
  overrides: Grant[],
) {
  const matches = await accessMatchesFor(tx, p, rows, context);
  const owners = await liveOwners(tx, rows);
  const selected = selectionMap(selection),
    exceptions = selectionMap(overrides);
  const snapshots: ConnectionAccessSnapshot[] = [];
  const data: Schema['ConnectionAccessResolution'][] = [];
  for (const c of rows) {
    if (!isToolConnection(c.kind) && c.owner_subject_id !== p.userId) {
      data.push(unavailable(c.id));
      continue;
    }
    const match = matches.get(c.id) || noMatch();
    const codes = readiness(c, owners.has(c.owner_subject_id!), context.permissions);

    const requestedOverride = exceptions.get(c.id);
    const canOverride =
      isToolConnection(c.kind) &&
      c.owner_subject_id === p.userId &&
      p.scopes.includes('connections:write') &&
      p.scopes.includes('runs:write') &&
      p.role !== 'viewer';
    const validOverride =
      requestedOverride && canOverride && requestedOverride.every((tool) => c.access_tools.includes(tool));
    if (requestedOverride && !canOverride) codes.push('override_forbidden');
    if (requestedOverride?.some((tool) => !c.access_tools.includes(tool)))
      codes.push('override_tool_not_approved');
    const persistent = match.scopes.length > 0;
    const desired =
      selection === undefined
        ? persistent
          ? c.access_tools
          : validOverride
            ? requestedOverride!
            : []
        : selected.get(c.id) || [];
    if (!persistent && !validOverride) codes.push('connection_access_denied');
    if (desired.some((tool) => !c.access_tools.includes(tool))) codes.push('tool_not_approved');
    if (desired.some((tool) => !toolAllowed(context.permissions, `${c.id}/${tool}`)))
      codes.push('tool_permission_denied');
    if (!persistent && desired.some((tool) => !validOverride || !requestedOverride!.includes(tool)))
      codes.push('connection_access_denied');
    const tools = desired.filter(
      (tool) =>
        c.access_tools.includes(tool) &&
        toolAllowed(context.permissions, `${c.id}/${tool}`) &&
        (persistent || (validOverride && requestedOverride!.includes(tool))),
    );
    const source =
      [...match.scopes].sort((a, b) => sourcePriority[a] - sourcePriority[b])[0] ||
      (validOverride ? 'run_override' : 'none');
    const invalid = codes.filter(
      (code) => !['tool_not_approved', 'tool_permission_denied', 'connection_access_denied'].includes(code),
    );
    const admitted = invalid.length ? [] : tools;
    if (!c.access_tools.length) codes.push('no_approved_tools');
    data.push({
      connection_id: c.id,
      name: c.name,
      tools: admitted,
      source,
      ready: codes.length === 0,
      can_override: canOverride,
      rejection_codes: [...new Set(codes)],
      access_match: match,
    });
    if (admitted.length)
      snapshots.push({
        connection_id: c.id,
        access_version: c.access_version,
        source,
        rule_id: match.matching_rules.find((r) => r.scope === source)?.rule_id,
        owner_subject_id: c.owner_subject_id!,
        external_account_id: c.external_account_id || null,
        ...(validOverride ? { override: { tools: requestedOverride!, authorized_by: p.userId! } } : {}),
      });
  }
  return { data, snapshots };
}
async function candidatePage(
  tx: Tx,
  p: Principal,
  context: ResolutionContext,
  after: string | undefined,
  limit: number,
  ids?: string[],
  direction: 'asc' | 'desc' = 'desc',
  overrideIds: string[] = [],
) {
  const args = new AccessParameters();
  const conditions = [];
  if (after) conditions.push(`c.id${direction === 'asc' ? '>' : '<'}${args.add(after)}::uuid`);
  if (ids) conditions.push(`c.id=ANY(${args.add(ids)}::uuid[])`);
  else {
    conditions.push(
      "COALESCE(c.data->>'deleted','false')<>'true'",
      `c.data->>'kind'=ANY(${args.add(toolConnectionKinds)}::text[])`,
    );
    conditions.push(
      `(c.id=ANY(${args.add(overrideIds)}::uuid[]) OR ${connectionAccessPredicate(p, context, args)})`,
    );
  }
  const rows = (
    await tx.query(
      `SELECT c.* FROM connections c WHERE ${conditions.join(' AND ')} ORDER BY c.id ${direction} LIMIT ${args.add(limit)}`,
      args.values,
    )
  ).rows;
  return rows.map((row) => resources.present(row, 'connections'));
}
export async function resolveRequestContext(
  tx: Tx,
  p: Principal,
  input: Schema['ConnectionAccessResolve'],
): Promise<ResolutionContext> {
  requireScopes(p, ['connections:read']);
  assert(
    [input.workspace_id, input.worktree_id, input.session_id].filter(Boolean).length === 1,
    400,
    'invalid_context',
    'Choose exactly one workspace, worktree or session.',
  );
  assert(
    !input.session_id || !input.agent_id,
    400,
    'session_configuration_immutable',
    'A session retains its verified agent origin.',
  );
  let worktree: resources.Document<'worktrees'> | undefined;
  let session: resources.Document<'sessions'> | undefined;
  let preset: resources.Document<'agents'> | undefined;
  if (input.session_id) {
    requireScopes(p, ['runs:read']);
    session = await resources.get(tx, 'sessions', input.session_id, p);
  }
  if (input.worktree_id) requireScopes(p, ['workspaces:read']);
  const wsId = input.worktree_id || session?.worktree_id;
  if (wsId) worktree = await resources.get(tx, 'worktrees', wsId, p);
  if (input.workspace_id) requireScopes(p, ['workspaces:read']);
  const workspace = await resources.get(tx, 'workspaces', input.workspace_id || worktree!.workspace_id, p);
  if (!worktree && workspace.default_worktree_id)
    worktree = await resources.get(tx, 'worktrees', workspace.default_worktree_id, p);
  if (input.agent_id) {
    requireScopes(p, ['runs:read']);
    preset = await resources.get(tx, 'agents', input.agent_id, p);
  }
  validatePermissions(input.permissions);
  return {
    workspace_id: workspace.id,
    agent_id: session?.agent_id || preset?.id || null,
    worktree_id: worktree?.id,
    defaults: session?.connection_grants ?? preset?.connection_grants,
    permissions: permissionLayers(
      workspace.permissions,
      worktree?.permissions,
      input.permissions ?? session?.run_permissions,
    ),
  };
}
export async function previewAccess(
  tx: Tx,
  p: Principal,
  input: Schema['ConnectionAccessResolve'],
  query: URLSearchParams,
): Promise<Schema['ConnectionAccessResolutionPage']> {
  const context = await resolveRequestContext(tx, p, input);
  const selection = selectedGrants(input.connection_grants, context.defaults),
    overrides = input.connection_access_overrides || [];
  const state = accessPageState(p, query, { kind: 'resolution', input, context });
  // Invalid proposed IDs remain per-item results; they do not hide the rest of the preview.
  const requested =
    selection !== undefined
      ? [...new Set([...selection, ...overrides].map((g) => g.connection_id))].sort().reverse()
      : undefined;
  const pageIds = requested
    ?.filter((value) => !state.after || value < state.after.id)
    .slice(0, state.limit + 1);
  const rows = await candidatePage(
    tx,
    p,
    context,
    state.after?.id,
    state.limit + 1,
    pageIds?.slice(0, state.limit),
    'desc',
    overrides.map((g) => g.connection_id),
  );
  // Proposed exceptions must remain visible even when the connection was removed
  // or never existed. Merge them into the same bounded keyset as automatic matches.
  const proposed =
    !requested && overrides.length
      ? await candidatePage(
          tx,
          p,
          context,
          state.after?.id,
          state.limit + 1,
          overrides.map((g) => g.connection_id),
        )
      : [];
  const available = new Map([...rows, ...proposed].map((row) => [row.id, row]));
  const candidates =
    pageIds ??
    [
      ...new Set([
        ...rows.map((row) => row.id),
        ...overrides.map((g) => g.connection_id).filter((value) => !state.after || value < state.after.id),
      ]),
    ]
      .sort()
      .reverse()
      .slice(0, state.limit + 1);
  const visible = candidates.slice(0, state.limit);
  const current = visible.flatMap((connectionId) => {
    const row = available.get(connectionId);
    return row ? [row] : [];
  });
  const result = await resolveRows(tx, p, context, current, selection, overrides);
  for (const connectionId of visible)
    if (!available.has(connectionId)) result.data.push(unavailable(connectionId));
  result.data.sort((a, b) => b.connection_id.localeCompare(a.connection_id));
  if (!context.worktree_id)
    for (const item of result.data)
      if (available.get(item.connection_id)?.kind === 'mcp_stdio') {
        item.ready = false;
        item.rejection_codes.push('worktree_permissions_pending');
      }
  return {
    data: result.data,
    next_cursor:
      candidates.length > state.limit ? state.cursor({ id: result.data.at(-1)!.connection_id }) : null,
  };
}
export async function admitConnections(
  tx: Tx,
  p: Principal,
  context: ResolutionContext,
  explicit: Grant[] | undefined,
  overrides: Grant[] = [],
) {
  const selection = selectedGrants(explicit, context.defaults);
  const ids =
    selection !== undefined
      ? [...new Set([...selection, ...overrides].map((g) => g.connection_id))]
      : undefined;
  for (const entries of [selection, overrides])
    if (entries)
      assert(
        new Set(entries.map((g) => g.connection_id)).size === entries.length,
        400,
        'duplicate_connection',
        'Select each connection once.',
      );
  assert(
    !ids || ids.length <= MAX_RUN_CONNECTIONS,
    400,
    'too_many_run_tools',
    `Select at most ${MAX_RUN_CONNECTIONS} connections for one run.`,
  );
  const missing = new Set([...(explicit || []), ...overrides].map((g) => g.connection_id));
  const grants: Grant[] = [],
    snapshots: ConnectionAccessSnapshot[] = [];
  const rejected: { connection_id: string; codes: string[] }[] = [];
  let after: string | undefined;
  do {
    const page = await candidatePage(
      tx,
      p,
      context,
      after,
      100,
      ids,
      'asc',
      overrides.map((g) => g.connection_id),
    );
    if (!page.length) break;
    // All admissions acquire connection locks in ascending ID order, across pages.
    await tx.query('SELECT id FROM connections WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE', [
      page.map((c) => c.id),
    ]);
    const current = (
      await tx.query('SELECT * FROM connections WHERE id=ANY($1::uuid[]) ORDER BY id', [
        page.map((c) => c.id),
      ])
    ).rows.map((row) => resources.present(row, 'connections'));
    const result = await resolveRows(tx, p, context, current, selection, overrides);
    for (const item of result.data) {
      missing.delete(item.connection_id);
      if (
        item.rejection_codes.length &&
        (explicit?.some((g) => g.connection_id === item.connection_id) ||
          overrides.some((g) => g.connection_id === item.connection_id))
      )
        rejected.push({ connection_id: item.connection_id, codes: item.rejection_codes });
      if (item.tools.length) grants.push({ connection_id: item.connection_id, tools: item.tools });
    }
    snapshots.push(...result.snapshots);
    assert(
      grants.length <= MAX_RUN_CONNECTIONS &&
        grants.reduce((sum, g) => sum + g.tools.length, 0) <= MAX_RUN_TOOLS,
      400,
      'too_many_run_tools',
      `Select at most ${MAX_RUN_CONNECTIONS} connections and ${MAX_RUN_TOOLS} tools for one run.`,
    );
    after = page.length === 100 ? page.at(-1)!.id : undefined;
  } while (after);
  assert(
    !rejected.length && !missing.size,
    400,
    'connection_access_rejected',
    'Some selected connections or tools are unavailable. Review the access preview.',
    { connections: rejected, missing_connection_ids: [...missing] },
  );
  return { grants, snapshots };
}
/** Re-evaluate current policy against the accepted maximum, including account binding.
 * Callers own run/connection lock order at the final dispatch boundary. */
export async function runtimeConnectionTools(tx: Tx, run: NativeRunRow, c: Connection): Promise<string[]> {
  const frozen = run.config.connection_access?.find((snapshot) => snapshot.connection_id === c.id);
  const selection = run.config.connection_grants?.find((grant) => grant.connection_id === c.id);
  if (
    !frozen ||
    !selection ||
    frozen.owner_subject_id !== c.owner_subject_id ||
    frozen.external_account_id !== (c.external_account_id || null)
  )
    return [];
  const owners = await liveOwners(tx, [c]);
  if (readiness(c, owners.has(c.owner_subject_id!), run.config.permission_layers || []).length) return [];
  const principal: Principal = {
    id: run.config.principal_id,
    userId: run.config.user_id,
    kind: run.config.principal_kind,
    organizationId: run.organization_id,
    role: 'member',
    scopes: [],
    workspaceIds: run.config.workspace_ids,
    operator: false,
  };
  const match = (
    await accessMatchesFor(tx, principal, [c], {
      workspace_id: run.workspace_id,
      agent_id: run.config.agent_id || null,
    })
  ).get(c.id)!;
  const exception =
    frozen.override?.authorized_by === run.config.user_id &&
    c.owner_subject_id === run.config.user_id &&
    (await actorAuthorized(tx, run, 'connections:write'));
  return selection.tools.filter(
    (tool) =>
      c.access_tools.includes(tool) &&
      toolAllowed(run.config.permission_layers || [], `${c.id}/${tool}`) &&
      (match.scopes.length || (exception && frozen.override!.tools.includes(tool))),
  );
}
