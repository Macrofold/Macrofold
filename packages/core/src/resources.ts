import type { Tx } from '../../db';
import { id } from './crypto';
import { assert } from './errors';
import type { Principal } from './auth';
import { requireProject, requireScopes } from './auth';
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
export type Document = {
  id: string;
  organization_id: string;
  created_at: string;
  revision: string;
  [field: string]: unknown;
};
function present(row: Record<string, unknown>): Document {
  const data = row.data as Record<string, unknown>;
  return {
    ...data,
    id: String(row.id),
    organization_id: String(row.organization_id),
    created_at: (row.created_at as Date).toISOString(),
    revision: String(row.revision),
    ...(row.project_id ? { project_id: row.project_id } : {}),
    ...(row.workspace_id ? { workspace_id: row.workspace_id } : {}),
  };
}
export async function get(tx: Tx, table: Table, resourceId: string, p?: Principal): Promise<Document> {
  const result = await tx.query(`SELECT * FROM ${table} WHERE id=$1`, [resourceId]);
  assert(result.rowCount, 404, 'not_found', 'Resource not found.');
  const doc = present(result.rows[0]);
  if (p) {
    assert(!doc.deleted, 404, 'not_found', 'Resource not found.');
    if (table === 'operations') {
      assert(
        Array.isArray(doc.required_scopes),
        403,
        'forbidden',
        'This historical operation has no authorization binding. Repeat the original resource request.',
      );
      requireScopes(p, doc.required_scopes as string[]);
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
export async function list(
  tx: Tx,
  table: Table,
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
    if (query.get('query')) {
      values.push(query.get('query'));
      conditions.push(`strpos(lower(data->>'name'),lower($${values.length}))>0`);
    }
  }
  if (query.get('cursor')) {
    values.push(query.get('cursor'));
    conditions.push(`id < $${values.length}::uuid`);
  }
  if (p.projectIds.length) {
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
    data: rows.slice(0, limit).map(present),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
export async function create(
  tx: Tx,
  table: Table,
  organization: string,
  data: Record<string, unknown>,
  forcedId = id(),
): Promise<Document> {
  const columns = ['id', 'organization_id', 'data'];
  const values: unknown[] = [forcedId, organization, JSON.stringify(data)];
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
  return present(rows.rows[0]);
}
export async function update(
  tx: Tx,
  table: Table,
  resourceId: string,
  data: Record<string, unknown>,
  expectedRevision?: string,
): Promise<Document> {
  const values: unknown[] = [JSON.stringify(data), resourceId];
  let where = 'id=$2';
  if (expectedRevision) {
    values.push(expectedRevision);
    where += ' AND revision=$3::bigint';
  }
  const result = await tx.query(
    `UPDATE ${table} SET data=data || $1::jsonb,revision=revision+1,updated_at=now() WHERE ${where} RETURNING *`,
    values,
  );
  assert(result.rowCount, 412, 'stale_revision', 'This resource changed. Reload and retry.');
  return present(result.rows[0]);
}
export async function remove(tx: Tx, table: Table, resourceId: string) {
  await tx.query(`DELETE FROM ${table} WHERE id=$1`, [resourceId]);
}
export async function operation(
  tx: Tx,
  p: Principal,
  kind: string,
  result: Record<string, unknown>,
  status = 'succeeded',
) {
  const scope =
    kind === 'webhook_replay'
      ? 'webhooks:read'
      : (kind.startsWith('workspace_') && kind !== 'workspace_restore') || kind === 'project_archive'
        ? 'projects:read'
        : 'files:read';
  let projectId = result.project_id;
  if (!projectId && result.workspace_id)
    projectId = (await get(tx, 'workspaces', String(result.workspace_id), p)).project_id;
  if (!projectId && result.checkpoint_id)
    projectId = (await get(tx, 'checkpoints', String(result.checkpoint_id), p)).project_id;
  if (!projectId && result.delivery_id)
    projectId = (await get(tx, 'deliveries', String(result.delivery_id), p)).project_id;
  assert(
    projectId || kind === 'webhook_replay',
    500,
    'operation_authorization_missing',
    'The operation must be bound to its project.',
  );
  return create(tx, 'operations', p.organizationId, {
    kind,
    status,
    result,
    required_scopes: [scope],
    ...(projectId ? { project_id: projectId } : {}),
  });
}
