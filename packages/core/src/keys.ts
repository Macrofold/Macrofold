import type { Tx } from '../../db';
import { id, token, sha256 } from './crypto';
import { assert } from './errors';
import { requireProject, type Principal } from './auth';
import type { components } from '../../contracts/api';

export function presentKey(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    ...((row.project_ids as string[])?.[0] ? { project_id: (row.project_ids as string[])[0] } : {}),
    ...(row.expires_at ? { expires_at: row.expires_at } : {}),
    ...(row.revoked_at ? { revoked_at: row.revoked_at } : {}),
    ...(row.last_used_at ? { last_used_at: row.last_used_at } : {}),
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
  if (p.projectIds.length)
    assert(
      input.project_id && p.projectIds.includes(input.project_id),
      403,
      'scope_escalation',
      'A restricted key cannot create an unrestricted key.',
    );
  if (input.project_id) requireProject(p, input.project_id);
  if (input.expires_at)
    assert(
      Date.parse(input.expires_at) > Date.now(),
      400,
      'invalid_expiry',
      'Expiration must be in the future.',
    );
  const secret = token();
  const result = await tx.query(
    'INSERT INTO api_keys(id,organization_id,user_id,name,key_hash,prefix,scopes,project_ids,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
    [
      id(),
      p.organizationId,
      p.userId,
      input.name,
      sha256(secret),
      secret.slice(0, 11),
      input.scopes,
      input.project_id ? [input.project_id] : [],
      input.expires_at || null,
    ],
  );
  return { ...presentKey(result.rows[0]), secret };
}
