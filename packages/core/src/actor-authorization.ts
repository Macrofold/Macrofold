import type { Tx } from '../../db';
import type { RunRow } from './runs';
import { assert } from './errors';
import { config } from './config';

/** Content-free current facts shared by tenant checks and the bounded direct
 * inference observer. A missing join denies access rather than guessing. */
export type ApiKeyActorFacts = {
  member_role: string | null;
  email_verified: boolean;
  key_bound: boolean;
  key_revoked: boolean;
  key_expired: boolean;
  scope_allowed: boolean;
  workspace_allowed: boolean;
  worker_allowed: boolean;
};

export function apiKeyActorAuthorized(facts: ApiKeyActorFacts) {
  return (
    !!facts.member_role &&
    facts.member_role !== 'viewer' &&
    facts.email_verified &&
    facts.key_bound &&
    !facts.key_revoked &&
    !facts.key_expired &&
    facts.scope_allowed &&
    facts.workspace_allowed &&
    facts.worker_allowed
  );
}
/** Recheck delegated execution authority at dispatch and before every external model/tool action. */
export async function actorAuthorized(
  tx: Tx,
  run: Pick<RunRow, 'organization_id' | 'workspace_id'> & {
    config: Pick<
      RunRow['config'],
      'user_id' | 'principal_id' | 'principal_kind' | 'oauth_token_id' | 'oauth_audience'
    > & { worker_id?: string };
  },
  scope = 'runs:write',
) {
  if (run.config.principal_kind === 'api_key') {
    const key = await tx.query<ApiKeyActorFacts>(
      `SELECT m.role AS member_role,coalesce(u."emailVerified",false) AS email_verified,
        k.id IS NOT NULL AS key_bound,k.revoked_at IS NOT NULL AS key_revoked,
        coalesce(k.expires_at<=now(),false) AS key_expired,
        coalesce($5=ANY(k.scopes),false) AS scope_allowed,
        coalesce(cardinality(k.workspace_ids)=0 OR $4=ANY(k.workspace_ids),false) AS workspace_allowed,
        coalesce($6::uuid IS NULL OR ('workers:use'=ANY(k.scopes) AND
          (cardinality(k.worker_ids)=0 OR $6=ANY(k.worker_ids))),false) AS worker_allowed
       FROM (SELECT 1) anchor
       LEFT JOIN memberships m ON m.organization_id=$2 AND m.user_id=$3
       LEFT JOIN auth."user" u ON u.id=m.user_id
       LEFT JOIN api_keys k ON k.id=$1 AND k.organization_id=$2 AND k.user_id=$3`,
      [
        run.config.principal_id,
        run.organization_id,
        run.config.user_id,
        run.workspace_id,
        scope,
        run.config.worker_id || null,
      ],
    );
    if (!apiKeyActorAuthorized(key.rows[0])) return false;
  } else {
    const member = await tx.query(
      `SELECT m.role FROM memberships m JOIN auth."user" u ON u.id=m.user_id WHERE m.organization_id=$1 AND m.user_id=$2 AND u."emailVerified"=true`,
      [run.organization_id, run.config.user_id],
    );
    if (!member.rowCount || member.rows[0].role === 'viewer') return false;
  }
  if (run.config.oauth_token_id) {
    // Admission delegates through the run deadline, so normal token expiration/rotation does not stop a run.
    // Explicit token/session/client revocation does. Retain expired records while dependent runs are active.
    const token = await tx.query(
      `SELECT 1 FROM auth."oauthAccessToken" t JOIN auth."oauthClient" c ON c."clientId"=t."clientId" JOIN auth."oauthClientResource" cr ON cr."clientId"=c."clientId" AND cr."resourceId"=$2 JOIN auth."oauthResource" r ON r.identifier=cr."resourceId" WHERE t.id=$1 AND t.scopes::jsonb ? $3 AND c.scopes::jsonb ? $3 AND ($4::uuid IS NULL OR (t.scopes::jsonb ? 'workers:use' AND c.scopes::jsonb ? 'workers:use')) AND t.revoked IS NULL AND c.disabled=false AND r.disabled=false AND (t."sessionId" IS NULL OR EXISTS(SELECT 1 FROM auth.session s WHERE s.id=t."sessionId" AND s."expiresAt">now()))`,
      [
        run.config.oauth_token_id,
        run.config.oauth_audience || `${config.origin}/v1`,
        scope,
        run.config.worker_id || null,
      ],
    );
    if (!token.rowCount) return false;
  }
  return true;
}

/** Key revocation and dependent Run cancellation commit together. Publication
 * takes the Run row first, so a committed revocation cannot lose to later C. */
export async function cancelApiKeyRuns(tx: Tx, keyId: string) {
  await tx.query(
    `UPDATE runs SET cancel_requested=true WHERE config->>'principal_kind'='api_key'
      AND config->>'principal_id'=$1 AND status IN ('queued','provisioning','running','waiting_for_input','persisting')`,
    [keyId],
  );
}
export async function requireRunActor(tx: Tx, run: Parameters<typeof actorAuthorized>[1]) {
  assert(
    await actorAuthorized(tx, run),
    403,
    'authorization_revoked',
    'The initiating account or credential is no longer authorized to run agents.',
  );
}
