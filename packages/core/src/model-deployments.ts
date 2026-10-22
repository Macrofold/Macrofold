import type { Tx } from '../../db';
import { lock, queryGroup } from '../../db';
import type { components } from '../../contracts/api';
import { validate as validUuid } from 'uuid';
import { requireScopes, requireWorkspace, type Principal } from './auth';
import { assert } from './errors';
import { id, unseal } from './crypto';
import * as resources from './resources';
import { actorAuthorizationQueries, actorAuthorizationFromResults } from './actor-authorization';
import type {
  DeploymentTarget,
  DeploymentRow,
  DeploymentRevisionRow,
  ModelDeploymentCapabilities,
} from './model-deployment-types';

type Schema = components['schemas'];
export type PreparedDeploymentRevision = Pick<
  DeploymentRevisionRow,
  'source' | 'runtime' | 'hosting' | 'capabilities' | 'source_evidence'
>;
type GrantRow = {
  id: string;
  deployment_id: string;
  subject_kind: 'subject' | 'api_key';
  subject_id: string;
  workspace_ids: string[] | null;
  created_at: Date;
  revoked_at: Date | null;
};

export async function deploymentRow(tx: Tx, deploymentId: string, forUpdate = false): Promise<DeploymentRow> {
  const row = (
    await tx.query<DeploymentRow>(
      `SELECT * FROM model_deployments WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [deploymentId],
    )
  ).rows[0];
  assert(row, 404, 'not_found', 'Model deployment not found.');
  return row;
}
export async function revisionRow(
  tx: Tx,
  deploymentId: string,
  revisionId: string,
): Promise<DeploymentRevisionRow> {
  const row = (
    await tx.query<DeploymentRevisionRow>(
      'SELECT * FROM model_deployment_revisions WHERE deployment_id=$1 AND id=$2',
      [deploymentId, revisionId],
    )
  ).rows[0];
  assert(row, 404, 'not_found', 'Model deployment revision not found.');
  return row;
}
function managementPrincipal(p: Principal) {
  requireScopes(p, ['model-deployments:write']);
  assert(
    p.userId && !p.workspaceIds.length && ['owner', 'admin'].includes(p.role),
    403,
    'permission_denied',
    'Deployment management requires an unrestricted owner or administrator using their own connections.',
  );
}
export function authorizeManagement(p: Principal, row: DeploymentRow) {
  managementPrincipal(p);
  assert(
    row.organization_id === p.organizationId && row.owner_subject_id === p.userId,
    403,
    'permission_denied',
    'Only this deployment’s owner may manage it.',
  );
}
/** Preparers and control-row lock waits can outlive request authentication.
 * Reuse the shared actor owner at the actual management commit boundary. */
export async function assertManagementTx(tx: Tx, p: Principal, row?: DeploymentRow) {
  if (row) authorizeManagement(p, row);
  else managementPrincipal(p);
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
  const facts = await queryGroup(tx, actorAuthorizationQueries(actor, ['model-deployments:write']));
  const role = facts[0]?.rows[0]?.member_role ?? facts[0]?.rows[0]?.role;
  assert(
    actorAuthorizationFromResults(actor, facts) && (role === 'owner' || role === 'admin'),
    403,
    'permission_denied',
    'Current owner membership and unrestricted deployment-management authority are required.',
  );
}
function canManage(p: Principal, row: DeploymentRow) {
  return (
    p.organizationId === row.organization_id &&
    p.userId === row.owner_subject_id &&
    !p.workspaceIds.length &&
    ['owner', 'admin'].includes(p.role) &&
    p.scopes.includes('model-deployments:write')
  );
}

async function applicationAccess(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  workspaceId: string | undefined,
  scope: 'model-deployments:read' | 'model-deployments:use',
) {
  requireScopes(p, [scope]);
  requireWorkspace(p, workspaceId ?? null);
  if (workspaceId) await resources.get(tx, 'workspaces', workspaceId, p);
  // The initiating API key can have been narrowed since request authentication.
  // This is current authority, independent of mutable service/worker readiness.
  const granted = await tx.query(
    `SELECT 1 FROM model_deployment_grants WHERE organization_id=$1 AND deployment_id=$2 AND revoked_at IS NULL
    AND ((subject_kind='subject' AND subject_id=$3) OR (subject_kind='api_key' AND subject_id=$4))
    AND (workspace_ids IS NULL OR $5::uuid=ANY(workspace_ids))
    AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM api_keys k WHERE k.id=$4::uuid AND k.organization_id=$1 AND k.user_id=$3
      AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>clock_timestamp()) AND $6=ANY(k.scopes)
      AND (cardinality(k.workspace_ids)=0 OR $5::uuid=ANY(k.workspace_ids)))) LIMIT 1`,
    [
      p.organizationId,
      deploymentId,
      p.userId ?? p.id,
      p.kind === 'api_key' ? p.id : null,
      workspaceId ?? null,
      scope,
    ],
  );
  assert(
    granted.rowCount,
    403,
    'permission_denied',
    'This application has no current grant for the deployment and workspace.',
  );
}
export async function authorizeDeploymentInvocationTx(
  tx: Tx,
  p: Principal,
  target: Pick<DeploymentTarget, 'deployment_id'> & Partial<DeploymentTarget>,
  workspaceId?: string,
) {
  await applicationAccess(tx, p, target.deployment_id, workspaceId, 'model-deployments:use');
  if (target.deployment_revision_id && (target.endpoint_connection_id || target.credential_connection_id))
    await selectedDeploymentConnectionTx(tx, p, {
      ...target,
      deployment_revision_id: target.deployment_revision_id,
    });
}

/** One current service resolution under the deployment lock, inside the normal
 * Run admission. HTTP idempotency replay precedes this operation. */
export async function resolveDeploymentTargetTx(
  tx: Tx,
  p: Principal,
  binding: Schema['DeploymentBinding'],
  workspaceId: string | undefined,
  timeoutSeconds: number,
): Promise<DeploymentTarget> {
  const row = await deploymentRow(tx, binding.deployment_id, true);
  await authorizeDeploymentInvocationTx(tx, p, binding, workspaceId);
  assert(
    !row.retired &&
      row.desired_state === 'running' &&
      ['ready', 'degraded'].includes(row.state) &&
      row.serving_revision_id,
    409,
    'deployment_not_ready',
    'This deployment is not accepting new inference requests.',
  );
  assert(
    !binding.deployment_revision_id || binding.deployment_revision_id === row.serving_revision_id,
    409,
    'deployment_binding_stale',
    'The requested revision is not currently serving.',
  );
  assert(
    !row.policy?.stop_at || Date.parse(row.policy.stop_at) >= Date.now() + timeoutSeconds * 1000,
    409,
    'deployment_not_ready',
    'The requested execution window does not fit before the scheduled stop.',
  );
  const revision = (
    await tx.query<
      Pick<DeploymentRevisionRow, 'id' | 'hosting' | 'capabilities'> & { endpoint_url: string | null }
    >(
      "SELECT id,hosting,capabilities,source_evidence->>'endpoint_url' AS endpoint_url FROM model_deployment_revisions WHERE deployment_id=$1 AND id=$2",
      [row.id, row.serving_revision_id],
    )
  ).rows[0];
  assert(revision, 503, 'deployment_unavailable', 'The serving revision metadata is unavailable.');
  if (revision.hosting.kind === 'external_openai') {
    const endpoint = revision.endpoint_url;
    assert(
      typeof endpoint === 'string',
      503,
      'deployment_unavailable',
      'The immutable endpoint reference is unavailable.',
    );
    return {
      deployment_id: row.id,
      deployment_revision_id: revision.id,
      endpoint_connection_id: revision.hosting.endpoint_connection_id,
      endpoint_url: endpoint,
      model_alias: revision.hosting.model_alias,
      capabilities: revision.capabilities,
    };
  }
  const resource = (
    await tx.query<{ id: string; endpoint_url: string; connection_id: string }>(
      "SELECT id,endpoint_url,connection_id FROM model_deployment_resources WHERE deployment_id=$1 AND revision_id=$2 AND deleted_at IS NULL AND state='ready'",
      [row.id, revision.id],
    )
  ).rows[0];
  assert(
    resource?.endpoint_url && (row.ready_replicas ?? 0) > 0,
    409,
    'deployment_not_ready',
    'This deployment has no observed ready capacity.',
  );
  return {
    deployment_id: row.id,
    deployment_revision_id: revision.id,
    endpoint_connection_id: null,
    credential_connection_id: resource.connection_id,
    provider_resource_id: resource.id,
    endpoint_url: resource.endpoint_url.replace(/\/$/, '') + '/v1',
    model_alias: `macrofold-${revision.id}`,
    capabilities: revision.capabilities,
  };
}
export async function deploymentCapacityTx(tx: Tx, deploymentId: string) {
  const row = (
    await tx.query<{ policy: DeploymentRow['policy']; count: string }>(
      `SELECT d.policy,(SELECT count(*) FROM runs
    WHERE config#>>'{deployment_target,deployment_id}'=$1 AND status IN ('queued','provisioning','running','waiting_for_input','persisting'))::text AS count
    FROM model_deployments d WHERE d.id=$1::uuid FOR UPDATE`,
      [deploymentId],
    )
  ).rows[0];
  assert(
    row?.policy && Number(row.count) < row.policy.max_concurrent_requests,
    429,
    'deployment_capacity',
    'This deployment’s concurrent request capacity is occupied.',
  );
}
type CredentialTarget = Pick<DeploymentTarget, 'deployment_id' | 'deployment_revision_id'> &
  Partial<DeploymentTarget>;
async function selectedDeploymentConnectionTx(tx: Tx, p: Principal, target: CredentialTarget) {
  const connectionId = target.endpoint_connection_id ?? target.credential_connection_id;
  assert(connectionId, 503, 'deployment_unavailable', 'The deployment has no credential binding.');
  const selected = (
    await tx.query<{
      data: resources.ResourceModels['connections'] & { deleted?: boolean };
      resource_secret: string | null;
    }>(
      `SELECT c.data,r.secret_ciphertext AS resource_secret
    FROM model_deployments d JOIN model_deployment_connections g ON g.deployment_id=d.id AND g.revision_id=$2 AND g.connection_id=$3 AND g.approved_by=d.owner_subject_id
    JOIN memberships owner_member ON owner_member.organization_id=d.organization_id AND owner_member.user_id=d.owner_subject_id AND owner_member.role IN ('owner','admin')
    JOIN auth."user" owner_user ON owner_user.id=owner_member.user_id AND owner_user."emailVerified"=true
    JOIN connections c ON c.id=g.connection_id AND c.organization_id=d.organization_id
    LEFT JOIN model_deployment_resources r ON r.id=$4 AND r.deployment_id=d.id AND r.revision_id=$2
    WHERE d.id=$1 AND d.organization_id=$5 AND c.data->>'owner_subject_id'=d.owner_subject_id`,
      [
        target.deployment_id,
        target.deployment_revision_id,
        connectionId,
        target.provider_resource_id ?? null,
        p.organizationId,
      ],
    )
  ).rows[0];
  const connection = selected?.data;
  assert(
    connection &&
      connection.kind === (target.endpoint_connection_id ? 'external_model' : 'runpod') &&
      connection.status === 'healthy' &&
      !connection.deleted,
    403,
    'permission_denied',
    'The exact delegated provider connection is no longer available.',
  );
  // Rotating a secret in the same connection is supported. Retargeting that
  // connection's origin requires a deliberate immutable deployment revision.
  if (target.endpoint_connection_id)
    assert(
      connection.url === target.endpoint_url,
      409,
      'deployment_binding_stale',
      'The endpoint connection changed; create and select a new revision.',
    );
  return { selected, connection };
}
export async function deploymentCredentialTx(
  tx: Tx,
  p: Principal,
  target: DeploymentTarget,
): Promise<Record<string, string>> {
  const { selected, connection } = await selectedDeploymentConnectionTx(tx, p, target);
  const headers = connection.headers_ciphertext
    ? unseal<Record<string, string>>(connection.headers_ciphertext)
    : {};
  if (connection.secret_ciphertext)
    headers.Authorization = `Bearer ${unseal<string>(connection.secret_ciphertext)}`;
  if (target.provider_resource_id) {
    assert(
      selected.resource_secret,
      503,
      'deployment_unavailable',
      'The admitted endpoint identity is unavailable.',
    );
    headers['x-macrofold-endpoint-secret'] = unseal<string>(selected.resource_secret);
  }
  return headers;
}

async function revisionConnections(tx: Tx, p: Principal, prepared: PreparedDeploymentRevision) {
  const selected: { id: string; kind: 'external_model' | 'runpod' | 'hugging_face' }[] = [];
  if (prepared.source.kind === 'hugging_face' && prepared.source.source_connection_id)
    selected.push({ id: prepared.source.source_connection_id, kind: 'hugging_face' });
  selected.push(
    prepared.hosting.kind === 'external_openai'
      ? { id: prepared.hosting.endpoint_connection_id, kind: 'external_model' }
      : { id: prepared.hosting.compute_connection_id, kind: 'runpod' },
  );
  for (const item of selected) {
    const connection = await resources.get(tx, 'connections', item.id);
    assert(
      connection.owner_subject_id === p.userId &&
        connection.kind === item.kind &&
        !connection.deleted &&
        connection.status === 'healthy',
      403,
      'permission_denied',
      'Select a healthy provider connection owned by the deployment owner.',
    );
  }
  return selected;
}
async function insertRevision(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  prepared: PreparedDeploymentRevision,
) {
  const connections = await revisionConnections(tx, p, prepared);
  const evidence = { ...prepared.source_evidence };
  if (prepared.hosting.kind === 'external_openai') {
    const connection = await resources.get(tx, 'connections', prepared.hosting.endpoint_connection_id);
    assert(
      connection.url && (!evidence.endpoint_url || evidence.endpoint_url === connection.url),
      409,
      'deployment_binding_stale',
      'The endpoint connection changed during preparation.',
    );
    evidence.endpoint_url = connection.url;
  }
  const revisionId = id();
  const row = (
    await tx.query<DeploymentRevisionRow>(
      'INSERT INTO model_deployment_revisions(id,organization_id,deployment_id,source,runtime,hosting,capabilities,source_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [
        revisionId,
        p.organizationId,
        deploymentId,
        JSON.stringify(prepared.source),
        JSON.stringify(prepared.runtime),
        JSON.stringify(prepared.hosting),
        JSON.stringify(prepared.capabilities),
        JSON.stringify(evidence),
      ],
    )
  ).rows[0];
  for (const connection of connections)
    await tx.query(
      'INSERT INTO model_deployment_connections(organization_id,deployment_id,revision_id,connection_id,approved_by) VALUES($1,$2,$3,$4,$5)',
      [p.organizationId, deploymentId, revisionId, connection.id, p.userId],
    );
  return row;
}
export async function create(
  tx: Tx,
  p: Principal,
  input: Schema['ModelDeploymentCreate'],
  prepared: PreparedDeploymentRevision,
): Promise<Schema['ModelDeployment']> {
  managementPrincipal(p);
  assert(
    input.name.trim().length > 0 && input.name.length <= 100,
    400,
    'invalid_model_deployment',
    'Choose a deployment name between one and 100 characters.',
  );
  await lock(tx, `organization:${p.organizationId}`);
  await assertManagementTx(tx, p);
  const deploymentId = id();
  await tx.query(
    'INSERT INTO model_deployments(id,organization_id,owner_subject_id,name) VALUES($1,$2,$3,$4)',
    [deploymentId, p.organizationId, p.userId, input.name.trim()],
  );
  const revision = await insertRevision(tx, p, deploymentId, prepared);
  await tx.query('UPDATE model_deployments SET desired_revision_id=$2 WHERE id=$1', [
    deploymentId,
    revision.id,
  ]);
  for (const grant of input.access.grants) await createGrant(tx, p, deploymentId, grant);
  return present(tx, p, await deploymentRow(tx, deploymentId));
}
export async function addRevision(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  prepared: PreparedDeploymentRevision,
): Promise<Schema['ModelDeploymentRevision']> {
  const row = await deploymentRow(tx, deploymentId, true);
  await assertManagementTx(tx, p, row);
  assert(!row.retired, 409, 'deployment_conflict', 'A retired deployment cannot receive revisions.');
  return presentRevision(await insertRevision(tx, p, deploymentId, prepared));
}
function presentRevision(row: DeploymentRevisionRow): Schema['ModelDeploymentRevision'] {
  return {
    deployment_id: row.deployment_id,
    deployment_revision_id: row.id,
    source: row.source,
    runtime: row.runtime,
    hosting: row.hosting,
    capabilities: row.capabilities,
    created_at: row.created_at.toISOString(),
  };
}
export async function getRevision(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  revisionId: string,
): Promise<Schema['ModelDeploymentRevision']> {
  await assertManagementTx(tx, p, await deploymentRow(tx, deploymentId));
  return presentRevision(await revisionRow(tx, deploymentId, revisionId));
}
function page(query: URLSearchParams) {
  const requested = Number(query.get('limit') ?? 25);
  assert(
    Number.isSafeInteger(requested) && requested >= 1 && requested <= 100,
    400,
    'invalid_request',
    'Use a page limit between one and 100.',
  );
  const limit = requested;
  const cursor = query.get('cursor');
  assert(
    !cursor || validUuid(cursor),
    400,
    'invalid_request',
    'Use the cursor supplied by the previous page.',
  );
  return { limit, cursor: cursor || null };
}
export async function listRevisions(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  query: URLSearchParams,
): Promise<Schema['ModelDeploymentRevisionPage']> {
  await assertManagementTx(tx, p, await deploymentRow(tx, deploymentId));
  const { limit, cursor } = page(query);
  const rows = (
    await tx.query<DeploymentRevisionRow>(
      'SELECT * FROM model_deployment_revisions WHERE deployment_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3',
      [deploymentId, cursor, limit + 1],
    )
  ).rows;
  return {
    data: rows.slice(0, limit).map(presentRevision),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
function presentGrant(row: GrantRow): Schema['ModelDeploymentGrant'] {
  return {
    grant_id: row.id,
    deployment_id: row.deployment_id,
    subject:
      row.subject_kind === 'api_key'
        ? { kind: 'api_key', api_key_id: row.subject_id }
        : { kind: 'subject', subject_id: row.subject_id },
    workspace_scope: row.workspace_ids
      ? { kind: 'selected', workspace_ids: row.workspace_ids }
      : { kind: 'all' },
    created_at: row.created_at.toISOString(),
    revoked_at: row.revoked_at?.toISOString() ?? null,
  };
}
export async function createGrant(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  input: Schema['ModelDeploymentGrantInput'],
): Promise<Schema['ModelDeploymentGrant']> {
  const row = await deploymentRow(tx, deploymentId, true);
  await assertManagementTx(tx, p, row);
  assert(!row.retired, 409, 'deployment_conflict', 'A retired deployment cannot receive grants.');
  const subject = input.subject.kind === 'api_key' ? input.subject.api_key_id : input.subject.subject_id;
  const member =
    input.subject.kind === 'api_key'
      ? await tx.query(
          `SELECT 1 FROM api_keys k JOIN memberships m ON m.user_id=k.user_id AND m.organization_id=k.organization_id
      WHERE k.id=$1 AND k.organization_id=$2 AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>clock_timestamp())`,
          [subject, p.organizationId],
        )
      : await tx.query('SELECT 1 FROM memberships WHERE organization_id=$1 AND user_id=$2', [
          p.organizationId,
          subject,
        ]);
  assert(
    member.rowCount,
    403,
    'permission_denied',
    'Select a current organization member or application key.',
  );
  const workspaces =
    input.workspace_scope.kind === 'all' ? null : [...new Set(input.workspace_scope.workspace_ids)].sort();
  assert(
    workspaces === null ||
      (workspaces.length >= 1 &&
        workspaces.length <= 100 &&
        workspaces.length ===
          (input.workspace_scope.kind === 'selected' ? input.workspace_scope.workspace_ids.length : 0)),
    400,
    'invalid_model_deployment',
    'Select between one and 100 distinct workspaces.',
  );
  if (workspaces) {
    const visible = await tx.query(
      "SELECT id FROM workspaces WHERE id=ANY($1::uuid[]) AND coalesce(data->>'deleted','false')<>'true'",
      [workspaces],
    );
    // Management is unrestricted; tenant RLS plus undeleted existence is the
    // complete workspace check. Do not hydrate each workspace under this lock.
    assert(visible.rowCount === workspaces.length, 404, 'not_found', 'Resource not found.');
  }
  const existing = await tx.query(
    "SELECT 1 FROM model_deployment_grants WHERE deployment_id=$1 AND subject_kind=$2 AND subject_id=$3 AND coalesce(workspace_ids,'{}'::uuid[])=coalesce($4::uuid[],'{}'::uuid[]) AND revoked_at IS NULL",
    [deploymentId, input.subject.kind, subject, workspaces],
  );
  assert(!existing.rowCount, 409, 'deployment_conflict', 'This grant is already active.');
  const count = (
    await tx.query<{ count: string }>(
      'SELECT count(*) FROM model_deployment_grants WHERE deployment_id=$1 AND revoked_at IS NULL',
      [deploymentId],
    )
  ).rows[0];
  assert(
    Number(count.count) < 100,
    409,
    'deployment_conflict',
    'A deployment supports at most 100 active grants.',
  );
  return presentGrant(
    (
      await tx.query<GrantRow>(
        'INSERT INTO model_deployment_grants(id,organization_id,deployment_id,subject_kind,subject_id,workspace_ids,approved_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [id(), p.organizationId, deploymentId, input.subject.kind, subject, workspaces, p.userId],
      )
    ).rows[0],
  );
}
export async function revokeGrant(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  grantId: string,
): Promise<Schema['ModelDeploymentGrant']> {
  await assertManagementTx(tx, p, await deploymentRow(tx, deploymentId, true));
  const row = (
    await tx.query<GrantRow>(
      'UPDATE model_deployment_grants SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1 AND deployment_id=$2 RETURNING *',
      [grantId, deploymentId],
    )
  ).rows[0];
  assert(row, 404, 'not_found', 'Deployment grant not found.');
  return presentGrant(row);
}
export async function listGrants(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  query: URLSearchParams,
): Promise<Schema['ModelDeploymentGrantPage']> {
  await assertManagementTx(tx, p, await deploymentRow(tx, deploymentId));
  const { limit, cursor } = page(query);
  const rows = (
    await tx.query<GrantRow>(
      'SELECT * FROM model_deployment_grants WHERE deployment_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT $3',
      [deploymentId, cursor, limit + 1],
    )
  ).rows;
  return {
    data: rows.slice(0, limit).map(presentGrant),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}

async function projections(
  tx: Tx,
  p: Principal,
  rows: DeploymentRow[],
): Promise<Schema['ModelDeployment'][]> {
  if (!rows.length) return [];
  const managedIds = rows.filter((row) => canManage(p, row)).map((row) => row.id);
  if (managedIds.length) await assertManagementTx(tx, p);
  // A bounded management-only projection preserves exact cleanup identities
  // without returning endpoint addresses, credentials or immutable manifests.
  const ownedResources = managedIds.length
    ? (
        await tx.query<{
          deployment_id: string;
          resource_id: string;
          provider_id: string | null;
          attempt_id: string;
          deployment_revision_id: string;
          state: Schema['ModelDeploymentResource']['state'];
          created_at: Date;
          deleted_at: Date | null;
        }>(
          `SELECT r.* FROM unnest($1::uuid[]) AS d(id) CROSS JOIN LATERAL (
          SELECT deployment_id,id AS resource_id,provider_id,attempt_id,revision_id AS deployment_revision_id,state,created_at,deleted_at
          FROM model_deployment_resources WHERE deployment_id=d.id
          ORDER BY (deleted_at IS NULL) DESC,created_at DESC,id DESC LIMIT 25) r`,
          [managedIds],
        )
      ).rows
    : [];
  const resourcesByDeployment = new Map<string, Schema['ModelDeploymentResource'][]>();
  for (const { deployment_id, created_at, deleted_at, ...resource } of ownedResources) {
    const items = resourcesByDeployment.get(deployment_id) ?? [];
    items.push({
      ...resource,
      created_at: created_at.toISOString(),
      deleted_at: deleted_at?.toISOString() ?? null,
    });
    resourcesByDeployment.set(deployment_id, items);
  }
  const revisions = (
    await tx.query<{
      id: string;
      hosting: DeploymentRevisionRow['hosting'];
      capabilities: ModelDeploymentCapabilities;
    }>('SELECT id,hosting,capabilities FROM model_deployment_revisions WHERE id=ANY($1::uuid[])', [
      rows.flatMap((row) => [
        row.desired_revision_id,
        ...(row.serving_revision_id ? [row.serving_revision_id] : []),
      ]),
    ])
  ).rows;
  const byRevision = new Map(revisions.map((revision) => [revision.id, revision]));
  // Partial known amounts stay useful, but a different owned resource with no
  // billing observation must not turn an incomplete total into a reported bill.
  const costs = (
    await tx.query<{
      deployment_id: string;
      period_start: Date | null;
      period_end: Date | null;
      estimated: string | null;
      reported: string | null;
      as_of: Date | null;
      unresolved: boolean;
      partially_reported: boolean;
    }>(
      `SELECT r.deployment_id,min(c.period_start) AS period_start,max(c.period_end) AS period_end,
    sum(c.estimated_micro_usd)::text AS estimated,sum(c.provider_reported_micro_usd)::text AS reported,max(c.as_of) AS as_of,
    bool_or(c.resource_id IS NULL OR (c.estimated_micro_usd IS NULL AND c.provider_reported_micro_usd IS NULL)
      OR r.state IN ('creating','ambiguous','cleanup_pending') OR (r.state='stopping' AND r.deleted_at IS NULL)) AS unresolved,
    count(DISTINCT r.id) FILTER (WHERE c.provider_reported_micro_usd IS NOT NULL)>0
      AND count(DISTINCT r.id) FILTER (WHERE c.provider_reported_micro_usd IS NOT NULL)<count(DISTINCT r.id) AS partially_reported
    FROM model_deployment_resources r LEFT JOIN model_deployment_cost_observations c ON c.resource_id=r.id
    WHERE r.deployment_id=ANY($1::uuid[]) GROUP BY r.deployment_id`,
      [rows.map((row) => row.id)],
    )
  ).rows;
  const byDeployment = new Map(costs.map((cost) => [cost.deployment_id, cost]));
  return rows.map((row) => {
    const revision = byRevision.get(row.serving_revision_id ?? row.desired_revision_id);
    const cost = byDeployment.get(row.id);
    return {
      id: row.id,
      deployment_id: row.id,
      name: row.name,
      can_manage: canManage(p, row),
      ...(managedIds.includes(row.id) ? { resources: resourcesByDeployment.get(row.id) ?? [] } : {}),
      desired_state: row.desired_state,
      desired_revision_id: row.desired_revision_id,
      serving_revision_id: row.serving_revision_id,
      state: row.state,
      admission_open:
        !row.retired &&
        row.desired_state === 'running' &&
        ['ready', 'degraded'].includes(row.state) &&
        !!row.serving_revision_id &&
        (!row.policy?.stop_at || Date.parse(row.policy.stop_at) > Date.now()),
      capabilities: row.serving_revision_id ? (revision?.capabilities ?? null) : null,
      policy: row.policy,
      ready_replicas: row.ready_replicas,
      observed_at: row.observed_at?.toISOString() ?? null,
      cost_policy: {
        basis: 'deployment',
        request_charge_micro_usd: '0',
        infrastructure_cost_included: false,
      },
      infrastructure_cost: {
        period_start: cost?.period_start?.toISOString() ?? null,
        period_end: cost?.period_end?.toISOString() ?? null,
        estimated_micro_usd: cost?.estimated ?? null,
        provider_reported_micro_usd: cost?.reported ?? null,
        // Historical managed amounts do not establish the current external bill.
        // See docs/projects/hugging-face-model-deployments-tech-design.md#9-capacity-cost-and-spending-policy.
        status:
          cost?.unresolved || cost?.partially_reported
            ? 'uncertain'
            : revision?.hosting.kind === 'external_openai'
              ? 'external_unknown'
              : cost?.reported !== undefined && cost.reported !== null
                ? 'provider_reported'
                : cost?.estimated !== undefined && cost.estimated !== null
                  ? 'estimated'
                  : 'uncertain',
        as_of: cost?.as_of?.toISOString() ?? null,
        unresolved_liability: !!(cost?.unresolved || cost?.partially_reported),
      },
      failure_code: row.failure_code,
      retired: row.retired,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  });
}
export async function get(
  tx: Tx,
  p: Principal,
  deploymentId: string,
  workspaceId?: string,
): Promise<Schema['ModelDeployment']> {
  requireScopes(p, ['model-deployments:read']);
  const row = await deploymentRow(tx, deploymentId);
  if (!canManage(p, row)) await applicationAccess(tx, p, deploymentId, workspaceId, 'model-deployments:read');
  return (await projections(tx, p, [row]))[0];
}
/** Mutations already authorized by their owner may return their own projection
 * without acquiring an unrelated read scope. */
export async function present(tx: Tx, p: Principal, row: DeploymentRow): Promise<Schema['ModelDeployment']> {
  return (await projections(tx, p, [row]))[0];
}
export async function list(
  tx: Tx,
  p: Principal,
  query: URLSearchParams,
): Promise<Schema['ModelDeploymentPage']> {
  requireScopes(p, ['model-deployments:read']);
  const workspaceId = query.get('workspace_id') ?? undefined;
  requireWorkspace(p, workspaceId ?? null);
  if (workspaceId) await resources.get(tx, 'workspaces', workspaceId, p);
  const { limit, cursor } = page(query);
  const rows = (
    await tx.query<DeploymentRow>(
      `SELECT d.* FROM model_deployments d WHERE ($1::uuid IS NULL OR d.id<$1) AND (
    (d.owner_subject_id=$2 AND $3::boolean) OR EXISTS(SELECT 1 FROM model_deployment_grants g
     WHERE g.deployment_id=d.id AND g.revoked_at IS NULL AND ((g.subject_kind='subject' AND g.subject_id=$2) OR (g.subject_kind='api_key' AND g.subject_id=$4))
     AND (g.workspace_ids IS NULL OR $5::uuid=ANY(g.workspace_ids)))) ORDER BY d.id DESC LIMIT $6`,
      [
        cursor,
        p.userId ?? p.id,
        !p.workspaceIds.length &&
          ['owner', 'admin'].includes(p.role) &&
          p.scopes.includes('model-deployments:write'),
        p.kind === 'api_key' ? p.id : null,
        workspaceId ?? null,
        limit + 1,
      ],
    )
  ).rows;
  return {
    data: await projections(tx, p, rows.slice(0, limit)),
    next_cursor: rows.length > limit ? rows[limit - 1].id : null,
  };
}
