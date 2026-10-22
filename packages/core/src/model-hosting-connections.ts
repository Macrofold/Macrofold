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
import { matchesDeploymentResource } from './model-deployment-resource';
import { mapConcurrent } from './concurrent';

async function assertCurrentAuthority(tx: Tx, p: Principal) {
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
}

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
        await assertCurrentAuthority(tx, c.p);
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
    const replacementSecret = body.secret;
    assert(replacementSecret.trim(), 400, 'credentials_required', 'Provide the replacement account key.');
    assert(
      snapshot.resources.every((r) => r.provider_id),
      409,
      'deployment_conflict',
      'Resolve the ambiguous hosting attempt before rotating its account key. Existing cleanup authority is retained.',
    );
    await mapConcurrent(snapshot.resources, 4, async (resource) => {
      const observation = await provider.inspect(replacementSecret, String(resource.provider_id));
      assert(
        observation && matchesDeploymentResource(resource, observation),
        409,
        'connection_identity_immutable',
        'The replacement key must retain access to the exact owned model endpoint. Use a separate connection for another provider account.',
      );
    });
  }
  return {
    commit: async (tx: Tx, p: Principal) => {
      if (connectionId && snapshot)
        await tx.query('SELECT id FROM connections WHERE id=$1 FOR UPDATE', [connectionId]);
      // Authority is evaluated after a possible connection-lock wait.
      await assertCurrentAuthority(tx, p);
      if (connectionId && snapshot) {
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
      const saved = await saveConnection(tx, p, body, connectionId);
      if (connectionId && snapshot?.connection.kind === 'runpod' && body.secret !== undefined)
        // Inspection, the connection lock and the resource snapshot above prove
        // that the replacement key still owns every unresolved paid endpoint.
        await tx.query(
          'UPDATE model_deployment_resources SET cleanup_secret_ciphertext=$2 WHERE connection_id=$1 AND deleted_at IS NULL',
          [connectionId, saved.secret_ciphertext],
        );
      return saved;
    },
    dispose: async () => {},
  };
}
