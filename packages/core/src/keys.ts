import type { Tx } from '../../db';
import { id, token, sha256 } from './crypto';
import { assert } from './errors';
import { requireWorkspace, type Principal } from './auth';
import type { components } from '../../contracts/api';

export type KeyRow = {
  id: string; name: string; prefix: string; scopes: string[]; workspace_ids: string[];
  expires_at: Date | null; revoked_at: Date | null; last_used_at: Date | null;
};
export function presentKey(row: KeyRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    ...(row.workspace_ids?.[0] ? { workspace_id: row.workspace_ids[0] } : {}),
    ...(row.expires_at ? { expires_at: row.expires_at.toISOString() } : {}),
    ...(row.revoked_at ? { revoked_at: row.revoked_at.toISOString() } : {}),
    ...(row.last_used_at ? { last_used_at: row.last_used_at.toISOString() } : {}),
  };
}
export async function createKey(tx: Tx, p: Principal, input: components['schemas']['KeyCreate']) {
  assert(p.userId, 403, 'forbidden', 'An organization member must own each key.');
  assert(
    input.scopes.length > 0 && input.scopes.every((s) => p.scopes.includes(s)),
    403,
    'scope_escalation',
    'A new key can only receive scopes you currently hold.',
  );
  if (p.workspaceIds.length)
    assert(
      input.workspace_id && p.workspaceIds.includes(input.workspace_id),
      403,
      'scope_escalation',
      'A restricted key cannot create an unrestricted key.',
    );
  if (input.workspace_id) requireWorkspace(p, input.workspace_id);
  if (input.expires_at)
    assert(
      Date.parse(input.expires_at) > Date.now(),
      400,
      'invalid_expiry',
      'Expiration must be in the future.',
    );
  const secret = token();
  const result = await tx.query<KeyRow>(
    'INSERT INTO api_keys(id,organization_id,user_id,name,key_hash,prefix,scopes,workspace_ids,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [
      id(),
      p.organizationId,
      p.userId,
      input.name,
      sha256(secret),
      secret.slice(0, 11),
      input.scopes,
      input.workspace_id ? [input.workspace_id] : [],
      input.expires_at || null,
    ],
  );
  return { ...presentKey(result.rows[0]), secret };
}
