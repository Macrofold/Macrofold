import { transaction, type Tx } from '../../db';
import type { Principal } from './auth';
import { actorAuthorized } from './actor-authorization';
import type { RequestContext } from './api-types';
import { input } from './api-types';
import { saveConnection, assertConnectionOwner } from './connections';
import * as resources from './resources';
import { canonical } from './crypto';
import { assert } from './errors';
import { runpodModelHosting } from '../../providers/src/runpod-model-hosting';
import type { DeploymentResourceRow, ModelHostingProvider } from './model-deployment-types';

async function activeResources(tx: Tx, connectionId: string) {
  return (
    await tx.query<DeploymentResourceRow>(
      'SELECT * FROM model_deployment_resources WHERE connection_id=$1 AND deleted_at IS NULL ORDER BY id',
      [connectionId],
    )
  ).rows;
}
const resourceIdentity = (rows: DeploymentResourceRow[]) =>
  canonical(
    rows.map((r) => ({ id: r.id, provider_id: r.provider_id, attempt_id: r.attempt_id, config: r.config })),
  );
/** An account key rotation must still reach every owned endpoint. Otherwise a
 * different account's 404 could strand paid resources or masquerade as cleanup.
 * Inspection is outside SQL; the connection lock fences a new resource claim.
 */
export async function prepareConnectionSave(
  c: RequestContext,
  provider: ModelHostingProvider = runpodModelHosting(),
) {
  const body = input<'ConnectionPatch'>(c),
    connectionId = c.params.connection_id;
  const snapshot = connectionId
    ? await transaction(c.p.organizationId, async (tx) => {
        const connection = await resources.get(tx, 'connections', connectionId, c.p);
        assertConnectionOwner(c.p, connection);
        return {
          connection,
          resources:
            connection.kind === 'runpod' && body.secret !== undefined
              ? await activeResources(tx, connectionId)
              : [],
        };
      })
    : undefined;
  if (snapshot?.connection.kind === 'runpod' && body.secret !== undefined) {
    assert(body.secret.trim(), 400, 'credentials_required', 'Provide the replacement account key.');
    assert(
      snapshot.resources.every((r) => r.provider_id),
      409,
      'deployment_conflict',
      'Resolve the ambiguous hosting attempt before rotating its account key. Existing cleanup authority is retained.',
    );
    for (const resource of snapshot.resources) {
      const observation = await provider.inspect(body.secret, String(resource.provider_id));
      assert(
        observation &&
          observation.config.image === resource.config.image &&
          typeof observation.config.env === 'object' &&
          observation.config.env !== null &&
          'MF_ATTEMPT_ID' in observation.config.env &&
          observation.config.env.MF_ATTEMPT_ID === resource.attempt_id,
        409,
        'connection_identity_immutable',
        'The replacement key must retain access to the exact owned model endpoint. Use a separate connection for another provider account.',
      );
    }
  }
  return {
    commit: async (tx: Tx, p: Principal) => {
      const actor = {
        organization_id: p.organizationId,
        workspace_id: null,
        config: {
          principal_id: p.id,
          principal_kind: p.kind,
          user_id: p.userId ?? p.id,
          oauth_token_id: p.oauthTokenId,
          oauth_audience: p.oauthAudience,
        },
      };
      assert(
        await actorAuthorized(tx, actor, 'connections:write'),
        403,
        'permission_denied',
        'Current connection-management authority is required.',
      );
      if (connectionId && snapshot) {
        await tx.query('SELECT id FROM connections WHERE id=$1 FOR UPDATE', [connectionId]);
        const current = await resources.get(tx, 'connections', connectionId, p);
        assert(
          current.revision === snapshot.connection.revision,
          409,
          'deployment_conflict',
          'The connection changed during preparation. Read it and retry the intended edit.',
        );
        if (snapshot.connection.kind === 'runpod' && body.secret !== undefined)
          assert(
            resourceIdentity(await activeResources(tx, connectionId)) ===
              resourceIdentity(snapshot.resources),
            409,
            'deployment_conflict',
            'Model resource ownership changed during credential validation. Retry the intended rotation.',
          );
      }
      return saveConnection(tx, p, body, connectionId);
    },
    dispose: async () => {},
  };
}
