import { afterAll, beforeAll, expect, it } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { authPool, pool, transaction } from '../../packages/db';
import { id, seal } from '../../packages/core/src/crypto';
import { createKey } from '../../packages/core/src/keys';
import * as resources from '../../packages/core/src/resources';
import * as deployments from '../../packages/core/src/model-deployments';
import type { PreparedDeploymentRevision } from '../../packages/core/src/model-deployments';
import type { Principal } from '../../packages/core/src/auth';
import type { ModelDeploymentCapabilities } from '../../packages/core/src/model-deployment-types';

const capabilities: ModelDeploymentCapabilities = {
  protocol: 'openai_chat',
  input_modalities: ['text'],
  chat_completions: true,
  json_object: false,
  json_schema: false,
  tools: false,
  streaming: false,
  stream_usage: false,
  accepted_parameters: ['temperature'],
  schema_keywords: [],
  schema_dialect: null,
  context_window_tokens: 2048,
  max_output_tokens: 256,
  max_concurrent_requests: 1,
};
let owner: Principal, foreign: Principal, application: Principal, workspace: string, otherWorkspace: string;
beforeAll(async () => {
  owner = (await fixtureAccount('Deployment access owner')).p;
  foreign = (await fixtureAccount('Deployment foreign tenant')).p;
  await transaction(owner.organizationId, async (tx) => {
    workspace = (
      await resources.create(tx, 'workspaces', owner.organizationId, { name: 'Granted workspace' })
    ).id;
    otherWorkspace = (
      await resources.create(tx, 'workspaces', owner.organizationId, { name: 'Other workspace' })
    ).id;
    const issued = await createKey(tx, owner, {
      name: 'Scoped model consumer',
      workspace_id: workspace,
      scopes: ['runs:write', 'runs:read', 'model-deployments:read', 'model-deployments:use'],
    });
    application = {
      ...owner,
      id: issued.id,
      kind: 'api_key',
      scopes: issued.scopes,
      workspaceIds: [workspace],
    };
  });
});
afterAll(async () => {
  await Promise.all([pool.end(), authPool.end()]);
});
async function fixture() {
  return transaction(owner.organizationId, async (tx) => {
    const connection = await resources.create(tx, 'connections', owner.organizationId, {
      name: 'Synthetic external endpoint',
      kind: 'external_model',
      auth_method: 'bearer',
      url: 'https://models.example.test/v1',
      owner_subject_id: owner.userId,
      secret_ciphertext: seal('fixture-secret-1'),
      status: 'healthy',
    });
    const prepared: PreparedDeploymentRevision = {
      source: { kind: 'external', repository: null, revision: null, capabilities },
      runtime: { kind: 'external', engine: null, version: null },
      hosting: {
        kind: 'external_openai',
        endpoint_connection_id: connection.id,
        model_alias: 'fixture-model',
        lifecycle: 'external',
        external_hosting_acknowledged: true,
      },
      capabilities,
      source_evidence: {},
    };
    const created = await deployments.create(
      tx,
      owner,
      { name: 'Fixture model', ...prepared, access: { grants: [] } },
      prepared,
    );
    return { created, connection, prepared };
  });
}
async function ready(deploymentId: string) {
  await transaction(owner.organizationId, (tx) =>
    tx.query(
      `UPDATE model_deployments SET desired_state='running',state='ready',
    serving_revision_id=desired_revision_id,policy=$2 WHERE id=$1`,
      [deploymentId, JSON.stringify({ max_concurrent_requests: 1 })],
    ),
  );
}
const grant = () => ({
  subject: { kind: 'api_key' as const, api_key_id: application.id },
  workspace_scope: { kind: 'selected' as const, workspace_ids: [workspace] },
});

it('creates stopped metadata and immutable provenance without implicit application access', async () => {
  const { created } = await fixture();
  expect(created).toMatchObject({
    desired_state: 'stopped',
    state: 'stopped',
    admission_open: false,
    serving_revision_id: null,
    cost_policy: { request_charge_micro_usd: '0' },
    infrastructure_cost: {
      status: 'external_unknown',
      estimated_micro_usd: null,
      provider_reported_micro_usd: null,
    },
  });
  const revision = await transaction(owner.organizationId, (tx) =>
    deployments.getRevision(tx, owner, created.id, created.desired_revision_id),
  );
  expect(revision.source).toMatchObject({ kind: 'external', repository: null, revision: null });
  await expect(
    transaction(owner.organizationId, (tx) =>
      deployments.authorizeDeploymentInvocationTx(tx, application, { deployment_id: created.id }, workspace),
    ),
  ).rejects.toMatchObject({ code: 'permission_denied' });
  await expect(
    transaction(owner.organizationId, (tx) =>
      tx.query('UPDATE model_deployment_revisions SET capabilities=$2 WHERE id=$1', [
        revision.deployment_revision_id,
        JSON.stringify(capabilities),
      ]),
    ),
  ).rejects.toMatchObject({ code: '23514' });
});

it('requires current scoped grants and hides privileged revision and connection details from recipients', async () => {
  const { created } = await fixture();
  const savedGrant = await transaction(owner.organizationId, (tx) =>
    deployments.createGrant(tx, owner, created.id, grant()),
  );
  const recipient = await transaction(owner.organizationId, (tx) =>
    deployments.get(tx, application, created.id, workspace),
  );
  expect(recipient).toMatchObject({ id: created.id, can_manage: false });
  expect(JSON.stringify(recipient)).not.toContain('fixture-secret');
  expect(recipient).not.toHaveProperty('hosting');
  await expect(
    transaction(owner.organizationId, (tx) => deployments.get(tx, application, created.id, otherWorkspace)),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    transaction(owner.organizationId, (tx) => deployments.get(tx, application, created.id)),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    transaction(owner.organizationId, (tx) =>
      deployments.getRevision(tx, application, created.id, created.desired_revision_id),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await transaction(owner.organizationId, (tx) =>
    deployments.revokeGrant(tx, owner, created.id, savedGrant.grant_id),
  );
  await expect(
    transaction(owner.organizationId, (tx) =>
      deployments.authorizeDeploymentInvocationTx(tx, application, { deployment_id: created.id }, workspace),
    ),
  ).rejects.toMatchObject({ code: 'permission_denied' });
});

it('exposes bounded exact cleanup identities only to the current owner with management authority', async () => {
  const { created, connection } = await fixture();
  const activeId = id();
  const attempts = Array.from({ length: 27 }, (_, index) => ({
    id: index === 0 ? activeId : id(),
    attempt_id: id(),
    provider_id: index === 0 ? 'provider-unresolved' : `provider-history-${index}`,
    created_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    deleted_at: index === 0 ? null : new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
  }));
  await transaction(owner.organizationId, async (tx) => {
    await deployments.createGrant(tx, owner, created.id, grant());
    await tx.query(
      `INSERT INTO model_deployment_resources(id,organization_id,deployment_id,revision_id,connection_id,attempt_id,provider_id,endpoint_url,secret_ciphertext,config,accepted_rates,state,created_at,deleted_at)
      SELECT a.id,$1,$2,$3,$4,a.attempt_id,a.provider_id,'https://private-endpoint.example.test',$5,'{}','{}',
        CASE WHEN a.deleted_at IS NULL THEN 'cleanup_pending' ELSE 'deleted' END,a.created_at,a.deleted_at
      FROM jsonb_to_recordset($6::jsonb) AS a(id uuid,attempt_id uuid,provider_id text,created_at timestamptz,deleted_at timestamptz)`,
      [
        owner.organizationId,
        created.id,
        created.desired_revision_id,
        connection.id,
        seal('fixture-private-resource-secret'),
        JSON.stringify(attempts),
      ],
    );
  });
  const [managed, recipient, listed] = await Promise.all([
    transaction(owner.organizationId, (tx) => deployments.get(tx, owner, created.id)),
    transaction(owner.organizationId, (tx) => deployments.get(tx, application, created.id, workspace)),
    transaction(owner.organizationId, (tx) =>
      deployments.list(tx, owner, new URLSearchParams({ limit: '100' })),
    ),
  ]);
  expect(managed.resources).toHaveLength(25);
  expect(managed.resources?.[0]).toMatchObject({
    resource_id: activeId,
    provider_id: 'provider-unresolved',
    attempt_id: attempts[0].attempt_id,
    deployment_revision_id: created.desired_revision_id,
    state: 'cleanup_pending',
    deleted_at: null,
  });
  expect(managed.resources?.map((item) => item.resource_id)).not.toContain(attempts[1].id);
  expect(managed.resources?.map((item) => item.resource_id)).toContain(attempts[26].id);
  expect(Object.keys(managed.resources![0]).sort()).toEqual([
    'attempt_id',
    'created_at',
    'deleted_at',
    'deployment_revision_id',
    'provider_id',
    'resource_id',
    'state',
  ]);
  expect(JSON.stringify(managed.resources)).not.toContain('private');
  expect(listed.data.find((item) => item.id === created.id)?.resources).toEqual(managed.resources);
  expect(recipient).not.toHaveProperty('resources');
});

it('enforces tenant isolation on confirmed existing deployments', async () => {
  const { created } = await fixture();
  expect(
    await transaction(owner.organizationId, (tx) => deployments.get(tx, owner, created.id)),
  ).toHaveProperty('id', created.id);
  await expect(
    transaction(foreign.organizationId, (tx) => deployments.get(tx, foreign, created.id)),
  ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  const list = await transaction(foreign.organizationId, (tx) =>
    deployments.list(tx, foreign, new URLSearchParams()),
  );
  expect(list.data).toEqual([]);
});

it('serializes duplicate grant creation and permits a new grant only after explicit revocation', async () => {
  const { created } = await fixture();
  const saved = await transaction(owner.organizationId, (tx) =>
    deployments.createGrant(tx, owner, created.id, grant()),
  );
  await expect(
    transaction(owner.organizationId, (tx) => deployments.createGrant(tx, owner, created.id, grant())),
  ).rejects.toMatchObject({ code: 'deployment_conflict' });
  await transaction(owner.organizationId, (tx) =>
    deployments.revokeGrant(tx, owner, created.id, saved.grant_id),
  );
  const next = await transaction(owner.organizationId, (tx) =>
    deployments.createGrant(tx, owner, created.id, grant()),
  );
  expect(next.grant_id).not.toBe(saved.grant_id);
  expect(next.revoked_at).toBeNull();
});

it('uses rotated credentials in the same immutable endpoint revision and rejects silent retargeting', async () => {
  const { created, connection } = await fixture();
  await transaction(owner.organizationId, (tx) => deployments.createGrant(tx, owner, created.id, grant()));
  await ready(created.id);
  const target = await transaction(owner.organizationId, (tx) =>
    deployments.resolveDeploymentTargetTx(tx, application, { deployment_id: created.id }, workspace, 30),
  );
  await transaction(owner.organizationId, (tx) =>
    resources.update(tx, 'connections', connection.id, { secret_ciphertext: seal('fixture-secret-2') }),
  );
  const headers = await transaction(owner.organizationId, (tx) =>
    deployments.deploymentCredentialTx(tx, application, target),
  );
  expect(headers).toEqual({ Authorization: 'Bearer fixture-secret-2' });
  expect(target.deployment_revision_id).toBe(created.desired_revision_id);
  await transaction(owner.organizationId, (tx) =>
    resources.update(tx, 'connections', connection.id, { url: 'https://other.example.test/v1' }),
  );
  await expect(
    transaction(owner.organizationId, (tx) => deployments.deploymentCredentialTx(tx, application, target)),
  ).rejects.toMatchObject({ code: 'deployment_binding_stale' });
  await transaction(owner.organizationId, (tx) =>
    resources.update(tx, 'connections', connection.id, { url: target.endpoint_url }),
  );
  // Hosting observations do not revoke publication of an already accepted answer.
  await transaction(owner.organizationId, (tx) =>
    tx.query(
      "UPDATE model_deployments SET desired_state='stopped',state='stopped',serving_revision_id=NULL WHERE id=$1",
      [created.id],
    ),
  );
  await expect(
    transaction(owner.organizationId, (tx) =>
      deployments.authorizeDeploymentInvocationTx(tx, application, target, workspace),
    ),
  ).resolves.toBeUndefined();
});

it('fences accepted credential delegation when its approving owner loses management membership', async () => {
  const { created } = await fixture();
  await transaction(owner.organizationId, (tx) => deployments.createGrant(tx, owner, created.id, grant()));
  await ready(created.id);
  const target = await transaction(owner.organizationId, (tx) =>
    deployments.resolveDeploymentTargetTx(tx, application, { deployment_id: created.id }, workspace, 30),
  );
  await transaction(owner.organizationId, (tx) =>
    tx.query("UPDATE memberships SET role='member' WHERE organization_id=$1 AND user_id=$2", [
      owner.organizationId,
      owner.userId,
    ]),
  );
  try {
    await expect(
      transaction(owner.organizationId, (tx) =>
        deployments.authorizeDeploymentInvocationTx(tx, application, target, workspace),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  } finally {
    await transaction(owner.organizationId, (tx) =>
      tx.query("UPDATE memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2", [
        owner.organizationId,
        owner.userId,
      ]),
    );
  }
});

it('rejects new stale pins and a removed deployment-use scope before inference admission', async () => {
  const { created } = await fixture();
  await transaction(owner.organizationId, (tx) => deployments.createGrant(tx, owner, created.id, grant()));
  await ready(created.id);
  await expect(
    transaction(owner.organizationId, (tx) =>
      deployments.resolveDeploymentTargetTx(
        tx,
        application,
        { deployment_id: created.id, deployment_revision_id: id() },
        workspace,
        30,
      ),
    ),
  ).rejects.toMatchObject({ code: 'deployment_binding_stale' });
  await transaction(owner.organizationId, (tx) =>
    tx.query("UPDATE api_keys SET scopes=array_remove(scopes,'model-deployments:use') WHERE id=$1", [
      application.id,
    ]),
  );
  try {
    await expect(
      transaction(owner.organizationId, (tx) =>
        deployments.authorizeDeploymentInvocationTx(
          tx,
          application,
          { deployment_id: created.id },
          workspace,
        ),
      ),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  } finally {
    await transaction(owner.organizationId, (tx) =>
      tx.query('UPDATE api_keys SET scopes=$2 WHERE id=$1', [application.id, application.scopes]),
    );
  }
});

it('rechecks a management key revoked after preparation before creating metadata or delegations', async () => {
  const { prepared } = await fixture();
  const issued = await transaction(owner.organizationId, (tx) =>
    createKey(tx, owner, {
      name: 'Temporary controller',
      scopes: ['model-deployments:read', 'model-deployments:write'],
    }),
  );
  const controller: Principal = { ...owner, id: issued.id, kind: 'api_key', scopes: issued.scopes };
  await transaction(owner.organizationId, (tx) =>
    tx.query('UPDATE api_keys SET revoked_at=clock_timestamp() WHERE id=$1', [controller.id]),
  );
  await expect(
    transaction(owner.organizationId, (tx) =>
      deployments.create(
        tx,
        controller,
        {
          name: 'Revoked controller must not create',
          ...prepared,
          access: { grants: [] },
        },
        prepared,
      ),
    ),
  ).rejects.toMatchObject({ code: 'permission_denied' });
  const unchanged = await transaction(owner.organizationId, (tx) =>
    tx.query('SELECT 1 FROM model_deployments WHERE name=$1', ['Revoked controller must not create']),
  );
  expect(unchanged.rowCount).toBe(0);
});
