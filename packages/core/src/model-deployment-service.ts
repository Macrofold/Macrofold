import { transaction, type Tx } from '../../db';
import type { components } from '../../contracts/api';
import type { Principal } from './auth';
import { requireScopes } from './auth';
import type { RequestContext } from './api-types';
import { input } from './api-types';
import { assert } from './errors';
import { config } from './config';
import { canonical, unseal } from './crypto';
import * as resources from './resources';
import * as deployments from './model-deployments';
import {
  runtimeCapabilities,
  modelServingImage,
  defaultRuntimeParameters,
  runtimeMemoryFits,
} from './model-deployment-profiles';
import type {
  DeploymentPolicy,
  DeploymentRevisionRow,
  DeploymentRates,
  GpuOffer,
  ModelHostingProvider,
} from './model-deployment-types';
import { inspectHuggingFace } from '../../providers/src/model-deployment-source';
import { runpodModelHosting } from '../../providers/src/runpod-model-hosting';
import { validateModelEndpointURL } from '../../providers/src/network';
type Schema = components['schemas'];

export async function ownedDeploymentConnection(
  tx: Tx,
  p: Principal,
  connectionId: string,
  kind: 'hugging_face' | 'runpod' | 'external_model',
) {
  const connection = await resources.get(tx, 'connections', connectionId);
  assert(
    connection.owner_subject_id === p.userId &&
      connection.organization_id === p.organizationId &&
      connection.kind === kind &&
      !connection.deleted &&
      connection.status === 'healthy',
    403,
    'permission_denied',
    'Select a healthy connection owned by the deployment owner.',
  );
  return connection;
}
function managementPrincipal(p: Principal) {
  requireScopes(p, ['model-deployments:write']);
  assert(
    p.userId && !p.workspaceIds.length && ['owner', 'admin'].includes(p.role),
    403,
    'permission_denied',
    'Use unrestricted owner authority to configure model hosting with your own connections.',
  );
}
async function sourceSecret(p: Principal, connectionId?: string) {
  if (!connectionId) return undefined;
  return transaction(p.organizationId, async (tx) => {
    const c = await ownedDeploymentConnection(tx, p, connectionId, 'hugging_face');
    assert(c.secret_ciphertext, 403, 'permission_denied', 'The Hugging Face connection has no credential.');
    return unseal<string>(c.secret_ciphertext);
  });
}
export async function inspect(
  p: Principal,
  body: Schema['ModelDeploymentInspectionInput'],
  provider: ModelHostingProvider = runpodModelHosting(),
): Promise<Schema['ModelDeploymentInspection']> {
  managementPrincipal(p);
  const result = await inspectHuggingFace(body, await sourceSecret(p, body.source.source_connection_id));
  if (body.compute_connection_id) {
    const secret = await transaction(p.organizationId, async (tx) => {
      const c = await ownedDeploymentConnection(tx, p, String(body.compute_connection_id), 'runpod');
      assert(c.secret_ciphertext, 403, 'permission_denied', 'The compute connection has no credential.');
      return unseal<string>(c.secret_ciphertext);
    });
    result.hosting_options = (await provider.catalog(secret))
      .filter(
        (o) =>
          result.memory_estimate_bytes === null ||
          runtimeMemoryFits(
            o.memory_bytes,
            result.memory_estimate_bytes,
            body.runtime_preferences?.parameters ?? defaultRuntimeParameters,
          ),
      )
      .map((o) => ({
        gpu_pool_id: o.pool,
        name: o.name,
        memory_bytes: o.memory_bytes,
        hourly_cost_micro_usd: o.hourly_micro_usd,
        region_ids: o.region_ids,
      }));
  }
  return result;
}
export async function prepareRevision(
  p: Principal,
  body: Schema['ModelDeploymentRevisionCreate'],
): Promise<deployments.PreparedDeploymentRevision> {
  managementPrincipal(p);
  if (body.hosting.kind === 'external_openai') {
    assert(
      body.source.kind === 'external' &&
        'kind' in body.runtime &&
        body.runtime.kind === 'external' &&
        body.hosting.external_hosting_acknowledged,
      400,
      'invalid_model_deployment',
      'Confirm external hosting responsibility and declare the endpoint capabilities and external runtime.',
    );
    const connection = await transaction(p.organizationId, (tx) =>
      ownedDeploymentConnection(
        tx,
        p,
        body.hosting.kind === 'external_openai' ? body.hosting.endpoint_connection_id : '',
        'external_model',
      ),
    );
    assert(
      connection.url,
      400,
      'invalid_model_deployment',
      'Configure the exact OpenAI base URL on the endpoint connection.',
    );
    await validateModelEndpointURL(connection.url);
    const url = new URL(connection.url);
    assert(
      !url.search && !url.hash && !url.pathname.endsWith('/'),
      400,
      'invalid_model_deployment',
      'Use an exact OpenAI base URL without a trailing slash, query or fragment, usually ending in /v1.',
    );
    assert(
      body.source.capabilities.chat_completions &&
        body.source.capabilities.max_output_tokens <= body.source.capabilities.context_window_tokens,
      422,
      'unsupported_model_capability',
      'Declare a compatible text chat endpoint with consistent output/context limits.',
    );
    return {
      source: body.source,
      runtime: body.runtime,
      hosting: body.hosting,
      capabilities: body.source.capabilities,
      source_evidence: { endpoint_url: connection.url, provenance: 'operator_declared' },
    };
  }
  assert(
    body.source.kind === 'hugging_face' && 'profile_id' in body.runtime,
    400,
    'invalid_model_deployment',
    'Managed hosting requires a Hugging Face source and reviewed runtime profile.',
  );
  const result = await inspect(p, {
    source: body.source,
    task: 'text_generation',
    runtime_preferences: body.runtime,
  });
  assert(
    result.supported && result.source,
    422,
    'unsupported_model_source',
    'Resolve the source inspection findings before creating a managed revision.',
    { findings: result.findings },
  );
  assert(
    !result.license_acknowledgement_required || body.source.license_acknowledged,
    422,
    'invalid_model_deployment',
    'Acknowledge the pinned model license and complete gated access with the source owner’s account.',
  );
  await transaction(p.organizationId, (tx) =>
    ownedDeploymentConnection(
      tx,
      p,
      body.hosting.kind === 'runpod_serverless' ? body.hosting.compute_connection_id : '',
      'runpod',
    ),
  );
  return {
    source: result.source,
    runtime: body.runtime,
    hosting: body.hosting,
    capabilities: runtimeCapabilities(body.runtime),
    source_evidence: {
      runtime_image: modelServingImage(),
      memory_estimate_bytes: result.memory_estimate_bytes,
      license: result.license,
      license_acknowledged_by: p.userId,
      license_acknowledged_at: new Date().toISOString(),
    },
  };
}
export async function prepareCreate(c: RequestContext) {
  const body = input<'ModelDeploymentCreate'>(c);
  const prepared = await prepareRevision(c.p, body);
  return {
    commit: (tx: Tx, p: Principal) => deployments.create(tx, p, body, prepared),
    dispose: async () => {},
  };
}
export async function prepareAddRevision(c: RequestContext) {
  await transaction(c.p.organizationId, async (tx) =>
    deployments.authorizeManagement(c.p, await deployments.deploymentRow(tx, c.params.deployment_id)),
  );
  const prepared = await prepareRevision(c.p, input<'ModelDeploymentRevisionCreate'>(c));
  return {
    commit: (tx: Tx, p: Principal) => deployments.addRevision(tx, p, c.params.deployment_id, prepared),
    dispose: async () => {},
  };
}
export async function prepareInspect(c: RequestContext) {
  const result = await inspect(c.p, input<'ModelDeploymentInspectionInput'>(c));
  return {
    commit: async (tx: Tx, p: Principal) => {
      await deployments.assertManagementTx(tx, p);
      const body = input<'ModelDeploymentInspectionInput'>(c);
      if (body.source.source_connection_id)
        await ownedDeploymentConnection(tx, p, body.source.source_connection_id, 'hugging_face');
      if (body.compute_connection_id)
        await ownedDeploymentConnection(tx, p, body.compute_connection_id, 'runpod');
      return result;
    },
    dispose: async () => {},
  };
}
export function validateServicePolicy(
  revision: DeploymentRevisionRow,
  policy: DeploymentPolicy,
  desired: 'running' | 'stopped',
  now = Date.now(),
) {
  assert(
    policy.max_concurrent_requests >= 1,
    422,
    'invalid_hosting_policy',
    'Choose a positive request capacity.',
  );
  if (policy.stop_at)
    assert(
      Number.isFinite(Date.parse(policy.stop_at)) &&
        (desired === 'stopped' || Date.parse(policy.stop_at) > now),
      422,
      'invalid_hosting_policy',
      'Choose a future stop time or ongoing operation.',
    );
  if (revision.hosting.kind === 'runpod_serverless') {
    assert(
      'min_replicas' in policy && policy.min_replicas >= 1 && policy.max_replicas >= policy.min_replicas,
      422,
      'invalid_hosting_policy',
      'Choose a positive warm minimum and an explicit maximum at least as large.',
    );
    assert(
      policy.max_concurrent_requests <= revision.capabilities.max_concurrent_requests * policy.max_replicas,
      422,
      'invalid_hosting_policy',
      'Request concurrency exceeds the selected runtime and replica capacity.',
    );
    assert(
      'profile_id' in revision.runtime &&
        (revision.runtime.parameters.tensor_parallel_size ?? 1) === revision.hosting.placement.gpu_count,
      422,
      'invalid_hosting_policy',
      'GPU count must match the immutable runtime tensor parallel layout.',
    );
  } else
    assert(
      !('min_replicas' in policy) &&
        policy.max_concurrent_requests <= revision.capabilities.max_concurrent_requests,
      422,
      'invalid_hosting_policy',
      'External hosting supports request concurrency and an optional stop time within its declared capability.',
    );
}
export function policyExpands(old: DeploymentPolicy | null, next: DeploymentPolicy) {
  if (!old || next.max_concurrent_requests > old.max_concurrent_requests) return true;
  if (old.stop_at && (!next.stop_at || Date.parse(next.stop_at) > Date.parse(old.stop_at))) return true;
  if ('min_replicas' in next)
    return (
      !('min_replicas' in old) ||
      next.min_replicas > old.min_replicas ||
      next.max_replicas > old.max_replicas ||
      BigInt(next.max_hourly_cost_micro_usd) > BigInt(old.max_hourly_cost_micro_usd)
    );
  return 'min_replicas' in old;
}
export async function quoteManagedService(
  revision: DeploymentRevisionRow,
  policy: DeploymentPolicy,
  secret: string,
  provider: ModelHostingProvider = runpodModelHosting(),
  currentOffers?: GpuOffer[],
): Promise<DeploymentRates> {
  assert(
    revision.hosting.kind === 'runpod_serverless' && 'min_replicas' in policy,
    422,
    'invalid_hosting_policy',
    'Managed hosting requires replica and hourly limits.',
  );
  const offers = currentOffers ?? (await provider.catalog(secret));
  const pools = revision.hosting.placement.gpu_pool_ids;
  const selected = offers.filter((o) => pools.includes(o.pool));
  assert(
    pools.every((pool) => selected.some((o) => o.pool === pool)) &&
      selected.every((o) => o.hourly_micro_usd !== null),
    422,
    'invalid_hosting_policy',
    'Every eligible GPU pool requires current complete price evidence.',
  );
  const memory = revision.source_evidence.memory_estimate_bytes;
  const parameters = 'profile_id' in revision.runtime ? revision.runtime.parameters : undefined;
  assert(
    typeof memory === 'string' &&
      parameters &&
      selected.every((o) =>
        runtimeMemoryFits(
          o.memory_bytes,
          memory,
          parameters,
          revision.hosting.kind === 'runpod_serverless' ? revision.hosting.placement.gpu_count : 1,
        ),
      ),
    422,
    'invalid_hosting_policy',
    'Every permitted GPU alternative must fit the model memory estimate.',
  );
  const maximum = selected.reduce(
    (max, o) => (BigInt(o.hourly_micro_usd ?? 0) > max ? BigInt(o.hourly_micro_usd ?? 0) : max),
    0n,
  );
  const gpu = maximum * BigInt(revision.hosting.placement.gpu_count) * BigInt(policy.max_replicas);
  // Published container-disk tariff, captured with the operation, is an
  // estimate. Provider-reported GPU/CPU/disk buckets remain authoritative cost
  // observations; no per-token infrastructure charge is invented.
  const requestedDiskGb = (BigInt(memory) * 2n + 999999999n) / 1000000000n;
  const diskGb = requestedDiskGb > 20n ? requestedDiskGb : 20n;
  const disk = (100000n * diskGb * BigInt(policy.max_replicas) + 719n) / 720n;
  const hourly = gpu + disk;
  assert(
    hourly <= BigInt(policy.max_hourly_cost_micro_usd),
    402,
    'deployment_budget_exhausted',
    'The maximum planned GPU and container-disk rate exceeds the submitted hourly ceiling.',
    { required_hourly_cost_micro_usd: hourly.toString() },
  );
  return {
    hourly_micro_usd: hourly.toString(),
    gpu_hourly_micro_usd: gpu.toString(),
    disk_hourly_micro_usd: disk.toString(),
    observed_at: new Date().toISOString(),
  };
}
export async function prepareService(
  c: RequestContext,
  provider: ModelHostingProvider = runpodModelHosting(),
) {
  const body = input<'ModelDeploymentServiceInput'>(c);
  const snapshot = await transaction(c.p.organizationId, async (tx) => {
    const row = await deployments.deploymentRow(tx, c.params.deployment_id);
    deployments.authorizeManagement(c.p, row);
    const revision = await deployments.revisionRow(tx, row.id, body.deployment_revision_id);
    validateServicePolicy(revision, body.policy, body.desired_state);
    if (body.desired_state === 'running' && revision.hosting.kind === 'runpod_serverless')
      assert(
        config.allowPaid,
        503,
        'execution_disabled',
        'The operator must authorize paid infrastructure execution before starting managed hosting.',
      );
    let secret: string | undefined;
    if (
      body.desired_state === 'running' &&
      revision.hosting.kind === 'runpod_serverless' &&
      (row.desired_state !== 'running' ||
        row.desired_revision_id !== revision.id ||
        policyExpands(row.policy, body.policy))
    ) {
      const connection = await ownedDeploymentConnection(
        tx,
        c.p,
        revision.hosting.compute_connection_id,
        'runpod',
      );
      assert(
        connection.secret_ciphertext,
        403,
        'permission_denied',
        'The compute connection has no credential.',
      );
      secret = unseal<string>(connection.secret_ciphertext);
    }
    return { row, revision, secret };
  });
  const rates = snapshot.secret
    ? await quoteManagedService(snapshot.revision, body.policy, snapshot.secret, provider)
    : undefined;
  return {
    commit: async (tx: Tx, p: Principal) => {
      const row = await deployments.deploymentRow(tx, c.params.deployment_id, true);
      await deployments.assertManagementTx(tx, p, row);
      assert(
        row.generation === snapshot.row.generation &&
          canonical(row.policy) === canonical(snapshot.row.policy),
        409,
        'deployment_conflict',
        'Another control action changed this deployment. Read current state and submit the intended policy again.',
      );
      assert(
        !row.retired || body.desired_state === 'stopped',
        409,
        'deployment_conflict',
        'A retired deployment cannot start.',
      );
      const revision = await deployments.revisionRow(tx, row.id, body.deployment_revision_id);
      validateServicePolicy(revision, body.policy, body.desired_state);
      if (body.desired_state === 'running') {
        const connectionId =
          revision.hosting.kind === 'external_openai'
            ? revision.hosting.endpoint_connection_id
            : revision.hosting.compute_connection_id;
        await ownedDeploymentConnection(
          tx,
          p,
          connectionId,
          revision.hosting.kind === 'external_openai' ? 'external_model' : 'runpod',
        );
      }
      // Explicit recovery or a new selected revision starts a fresh bounded
      // episode. Capacity edits retain its clock rather than extending spending.
      // See docs/projects/hugging-face-model-deployments-tech-design.md#7-service-updates-drain-and-cleanup.
      await tx.query(
        `UPDATE model_deployments SET desired_state=$2,desired_revision_id=$3,policy=$4,generation=generation+1,
      state=CASE WHEN $2='stopped' THEN CASE WHEN state='stopped' THEN 'stopped' ELSE 'stopping' END
        WHEN serving_revision_id=$3 AND state IN ('ready','degraded') THEN state ELSE 'starting' END,
      accepted_rates=coalesce($5::jsonb,accepted_rates), failure_code=NULL,failure_attempts=0,
      startup_at=CASE WHEN $2='running' THEN CASE
        WHEN desired_state<>'running' OR desired_revision_id<>$3 OR failure_code='service_recovery_exhausted' THEN now()
        ELSE coalesce(startup_at,now()) END ELSE NULL END,
      drain_started_at=CASE WHEN $2='stopped' OR (serving_revision_id IS NOT NULL AND serving_revision_id<>$3) THEN coalesce(drain_started_at,now()) ELSE NULL END,
      next_check_at=now(),updated_at=now() WHERE id=$1`,
        [
          row.id,
          body.desired_state,
          revision.id,
          JSON.stringify(body.policy),
          rates ? JSON.stringify(rates) : null,
        ],
      );
      return deployments.present(tx, p, await deployments.deploymentRow(tx, row.id));
    },
    dispose: async () => {},
  };
}
export async function retire(tx: Tx, p: Principal, deploymentId: string) {
  const row = await deployments.deploymentRow(tx, deploymentId, true);
  await deployments.assertManagementTx(tx, p, row);
  await tx.query(
    `UPDATE model_deployments SET retired=true,desired_state='stopped',generation=generation+1,
    state=CASE WHEN state='stopped' THEN 'stopped' ELSE 'stopping' END,
    drain_started_at=coalesce(drain_started_at,now()),next_check_at=now(),updated_at=now() WHERE id=$1`,
    [row.id],
  );
  return deployments.present(tx, p, await deployments.deploymentRow(tx, row.id));
}
