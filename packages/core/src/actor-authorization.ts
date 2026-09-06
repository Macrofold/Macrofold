import type { Tx } from '../../db';
import type { RunRow } from './runs';
import { assert } from './errors';
import { config } from './config';
/** Recheck delegated execution authority at dispatch and before every external model/tool action. */
export async function actorAuthorized(
  tx: Tx,
  run: Pick<RunRow, 'organization_id' | 'project_id'> & {
    config: Pick<RunRow['config'], 'user_id' | 'principal_id' | 'principal_kind' | 'oauth_token_id'>;
  },
  scope = 'runs:write',
) {
  const member = await tx.query(
    `SELECT m.role FROM memberships m JOIN auth."user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2 AND u."emailVerified"=true`,
    [run.organization_id, run.config.user_id],
  );
  if (!member.rowCount || member.rows[0].role === 'viewer') return false;
  if (run.config.principal_kind === 'api_key') {
    const key = await tx.query(
      `SELECT 1 FROM api_keys WHERE id=$1 AND organization_id=$2 AND user_id=$3 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND $5=ANY(scopes) AND (cardinality(project_ids)=0 OR $4=ANY(project_ids))`,
      [run.config.principal_id, run.organization_id, run.config.user_id, run.project_id, scope],
    );
    if (!key.rowCount) return false;
  }
  if (run.config.oauth_token_id) {
    // Admission delegates through the run deadline, so normal token expiration/rotation does not stop a run.
    // Explicit token/session/client revocation does. Retain expired records while dependent runs are active.
    const token = await tx.query(
      `SELECT 1 FROM auth."oauthAccessToken" t JOIN auth."oauthClient" c ON c."clientId"=t."clientId" JOIN auth."oauthClientResource" cr ON cr."clientId"=c."clientId" AND cr."resourceId"=$2 JOIN auth."oauthResource" r ON r.identifier=cr."resourceId" WHERE t.id=$1 AND t.revoked IS NULL AND c.disabled=false AND r.disabled=false AND (t."sessionId" IS NULL OR EXISTS(SELECT 1 FROM auth.session s WHERE s.id=t."sessionId" AND s."expiresAt">now()))`,
      [run.config.oauth_token_id, `${config.origin}/v1`],
    );
    if (!token.rowCount) return false;
  }
  return true;
}
export async function requireRunActor(tx: Tx, run: RunRow) {
  assert(
    await actorAuthorized(tx, run),
    403,
    'authorization_revoked',
    'The initiating account or credential is no longer authorized to run agents.',
  );
}
