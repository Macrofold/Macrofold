import type { Tx } from '../../db';
import { id } from './crypto';
import { assert } from './errors';
import type { Principal } from './auth';
import { requireProject, requireScopes } from './auth';
import { operationAuthority, type OperationKind, type OperationResults } from './operations';
export const tables = [
  'projects',
  'workspaces',
  'agents',
  'sessions',
  'connections',
  'checkpoints',
  'artifacts',
  'webhooks',
  'deliveries',
  'operations',
  'transfers',
] as const;
export type Table = (typeof tables)[number];
import type { Document, ResourceModels } from './resource-models';
export type { Document, ResourceModels } from './resource-models';
export function present<K extends Table>(row: Record<string, unknown>, table: K): Document<K> {
  // JSONB is written by typed resource commands after boundary validation.
  const data = row.data as ResourceModels[K];
  return {
    ...data,
    id: String(row.id),
    organization_id: String(row.organization_id),
    created_at: (row.created_at as Date).toISOString(),
    revision: String(row.revision),
    ...(table === 'connections'
      ? {
          access_organization_wide: row.access_organization_wide,
          access_tools: row.access_tools,
          access_version: String(row.access_version),
        }
      : {}),
    ...(table === 'agents' ? { version: Number(row.revision) } : {}),
    ...(row.project_id ? { project_id: String(row.project_id) } : {}),
    ...(row.workspace_id ? { workspace_id: String(row.workspace_id) } : {}),
  };
}
export async function get<K extends Table>(
  tx: Tx,
  table: K,
  resourceId: string,
  p?: Principal,
): Promise<Document<K>> {
  const result = await tx.query(`SELECT * FROM ${table} WHERE id=$1`, [resourceId]);
  assert(result.rowCount, 404, 'not_found', 'Resource not found.');
  const doc = present(result.rows[0], table);
  if (p) {
    assert(!doc.deleted, 404, 'not_found', 'Resource not found.');
    if (table === 'operations') {
      assert(
        Array.isArray((doc as Document<'operations'>).required_scopes),
        403,
        'forbidden',
        'This historical operation has no authorization binding. Repeat the original resource request.',
      );
      requireScopes(p, (doc as Document<'operations'>).required_scopes as string[]);
    }
    if (table === 'projects') requireProject(p, doc.id);
    else if (doc.project_id) requireProject(p, String(doc.project_id));
    else if (doc.workspace_id) {
      const workspace = await get(tx, 'workspaces', String(doc.workspace_id));
      requireProject(p, String(workspace.project_id));
    }
  }
  return doc;
}
export async function list<K extends Table>(
  tx: Tx,
  table: K,
  p: Principal,
  query: URLSearchParams,
  filter: Record<string, unknown> = {},
) {
  const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 25));
  const values: unknown[] = [JSON.stringify(filter)];
  const conditions = ['data @> $1::jsonb', "COALESCE(data->>'deleted','false')<>'true'"];
  if (table === 'projects') {
    if (query.has('archived')) {
      values.push(query.get('archived') === 'true');
      conditions.push(`coalesce((data->>'archived')::boolean,false)=$${values.length}`);
    }
  }
  if (table === 'projects' || table === 'agents') {
    if (query.get('query')) {
      values.push(query.get('query'));
      conditions.push(`strpos(lower(data->>'name'),lower($${values.length}))>0`);
    }
  }
  if (query.get('cursor')) {
    values.push(query.get('cursor'));
    conditions.push(`id < $${values.length}::uuid`);
  }
  if (p.projectIds.length && table !== 'agents') {
    values.push(p.projectIds);
    conditions.push(
      table === 'projects'
        ? `id=ANY($${values.length}::uuid[])`
        : table === 'workspaces'
          ? `project_id=ANY($${values.length}::uuid[])`
          : `(data->>'project_id')=ANY($${values.length}::text[])`,
    );
  }
  values.push(limit + 1);
  const rows = (
    await tx.query(
      `SELECT * FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY id DESC LIMIT $${values.length}`,
      values,
    )
  ).rows;
  return {
    data: rows.slice(0, limit).map((row) => present(row, table)),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}

const connectionColumns = new Set(['access_organization_wide', 'access_tools', 'access_version']);
function persistedFields(table: Table, data: object) {
  const entries = Object.entries(data);
  const columns =
    table === 'connections'
      ? entries.filter(([key, value]) => connectionColumns.has(key) && value !== undefined)
      : [];
  return {
    columns,
    json: JSON.stringify(
      Object.fromEntries(entries.filter(([key]) => table !== 'connections' || !connectionColumns.has(key))),
    ),
  };
}

export async function create<K extends Table>(
  tx: Tx,
  table: K,
  organization: string,
  data: Partial<Document<NoInfer<K>>>,
  forcedId = id(),
): Promise<Document<K>> {
  const columns = ['id', 'organization_id', 'data'];
  const fields = persistedFields(table, data);
  const values: unknown[] = [forcedId, organization, fields.json];
  for (const [key, value] of fields.columns) {
    columns.push(key);
    values.push(value);
  }
  if (table === 'workspaces') {
    columns.push('project_id');
    values.push(data.project_id);
  }
  if (table === 'sessions') {
    columns.push('workspace_id');
    values.push(data.workspace_id);
  }
  const rows = await tx.query(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${values.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    values,
  );
  return present(rows.rows[0], table);
}
export async function update<K extends Table>(
  tx: Tx,
  table: K,
  resourceId: string,
  data: Partial<Document<NoInfer<K>>>,
  expectedRevision?: string,
): Promise<Document<K>> {
  const fields = persistedFields(table, data);
  const values: unknown[] = [fields.json, resourceId];
  const columns = fields.columns.map(([key, value]) => {
    values.push(value);
    return `${key}=$${values.length}`;
  });
  let where = 'id=$2';
  if (expectedRevision) {
    values.push(expectedRevision);
    where += ` AND revision=$${values.length}::bigint`;
  }
  const result = await tx.query(
    `UPDATE ${table} SET data=data || $1::jsonb,revision=revision+1,updated_at=now()${columns.length ? ',' + columns.join(',') : ''} WHERE ${where} RETURNING *`,
    values,
  );
  assert(result.rowCount, 412, 'stale_revision', 'This resource changed. Reload and retry.');
  return present(result.rows[0], table);
}
export async function remove(tx: Tx, table: Table, resourceId: string) {
  await tx.query(`DELETE FROM ${table} WHERE id=$1`, [resourceId]);
}
export async function operation<K extends OperationKind>(
  tx: Tx,
  p: Principal,
  kind: K,
  result: OperationResults[NoInfer<K>],
  status: Document<'operations'>['status'] = 'succeeded',
) {
  const authority = operationAuthority[kind];
  assert(authority, 500, 'operation_authorization_missing', 'The operation has no authorization definition.');
  let projectId: string | undefined;
  if (authority.binding === 'workspace' && 'workspace_id' in result)
    projectId = (await get(tx, 'workspaces', result.workspace_id)).project_id;
  else if (authority.binding === 'checkpoint' && 'checkpoint_id' in result && result.checkpoint_id)
    projectId = (await get(tx, 'checkpoints', result.checkpoint_id)).project_id;
  else if (authority.binding === 'project' && 'project_id' in result)
    projectId = (await get(tx, 'projects', result.project_id)).id;
  assert(
    projectId || authority.binding === 'organization',
    500,
    'operation_authorization_missing',
    'The operation must be bound to its project.',
  );
  if (projectId) requireProject(p, projectId);
  const saved = await create(tx, 'operations', p.organizationId, {
    kind,
    status,
    result,
    required_scopes: [authority.scope],
    ...(projectId ? { project_id: projectId } : {}),
  });
  return { ...saved, kind, result };
}
