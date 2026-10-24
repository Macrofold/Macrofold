import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { authPool, pool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id, seal } from '../../packages/core/src/crypto';
import { createKey } from '../../packages/core/src/keys';
import { handleApi } from '../../packages/core/src/http';
import * as resources from '../../packages/core/src/resources';
import * as deployments from '../../packages/core/src/model-deployments';
import * as sourceProvider from '../../packages/providers/src/model-deployment-source';
import {
  quoteManagedService,
  modelHostingPools,
  policyExpands,
  prepareRevision,
  prepareService,
  validateServicePolicy,
} from '../../packages/core/src/model-deployment-service';
import { runtimeCapabilities } from '../../packages/core/src/model-deployment-profiles';
import type { Principal } from '../../packages/core/src/auth';
import type { RequestContext } from '../../packages/core/src/api-types';
import type { components } from '../../packages/contracts/api';
import type {
  DeploymentRevisionRow,
  DeploymentPolicy,
  GpuOffer,
  ModelHostingProvider,
} from '../../packages/core/src/model-deployment-types';

type Schema = components['schemas'];
let owner: Principal, ownerKey: string;
const initialPaid = config.allowPaid;
const runtime: Schema['ModelDeploymentRuntime'] = {
  profile_id: 'vllm-0.32.0-text',
  parameters: {
    context_window_tokens: 4096,
    max_output_tokens: 512,
    max_concurrent_requests: 2,
    tensor_parallel_size: 2,
  },
};
const policy = (): DeploymentPolicy & {
  min_replicas: number;
  max_replicas: number;
  max_hourly_cost_micro_usd: string;
} => ({
  min_replicas: 1,
  max_replicas: 3,
  max_concurrent_requests: 4,
  max_hourly_cost_micro_usd: '9010000',
  stop_at: null,
});
const offers = (): GpuOffer[] => [
  {
    pool: 'pool-a',
    id: 'gpu-a',
    name: 'Fixture A',
    memory_bytes: '24000000000',
    hourly_micro_usd: '1000000',
    region_ids: ['fixture-region'],
  },
  {
    pool: 'pool-b',
    id: 'gpu-b',
    name: 'Fixture B',
    memory_bytes: '24000000000',
    hourly_micro_usd: '1500000',
    region_ids: ['fixture-region'],
  },
];
function provider(catalog = offers()): ModelHostingProvider {
  const unexpected = async () => {
    throw new Error('Unexpected billable provider effect in fixture');
  };
  return {
    catalog: vi.fn().mockResolvedValue(catalog),
    create: vi.fn(unexpected),
    inspect: vi.fn(unexpected),
    findAttempt: vi.fn(unexpected),
    update: vi.fn(unexpected),
    delete: vi.fn(unexpected),
    costs: vi.fn(unexpected),
  };
}
function revision(overrides: Partial<DeploymentRevisionRow> = {}): DeploymentRevisionRow {
  return {
    id: id(),
    organization_id: id(),
    deployment_id: id(),
    source: {
      kind: 'hugging_face',
      repository: 'fixture/model',
      revision: 'a'.repeat(40),
      weight_files: ['model.safetensors'],
      license_acknowledged: true,
    },
    runtime,
    hosting: {
      kind: 'runpod_serverless',
      compute_connection_id: id(),
      placement: { region_ids: ['fixture-region'], gpu_pool_ids: ['pool-a', 'pool-b'], gpu_count: 2 },
    },
    capabilities: runtimeCapabilities(runtime),
    source_evidence: { memory_estimate_bytes: '12000000000' },
    created_at: new Date(),
    ...overrides,
  };
}
beforeAll(async () => {
  const account = await fixtureAccount('Model service fixture');
  owner = account.p;
  ownerKey = account.key;
});
afterEach(() => {
  config.allowPaid = initialPaid;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('creates an external SystemOne revision through the public API without contacting a host', async () => {
  vi.stubEnv('LOCAL_MODEL_ENDPOINT_ALLOWED_ORIGINS', 'http://127.0.0.1:31337');
  const connection = await transaction(owner.organizationId, (tx) =>
    resources.create(tx, 'connections', owner.organizationId, {
      name: 'Local SystemOne fixture',
      kind: 'external_model',
      url: 'http://127.0.0.1:31337/v1',
      auth_method: 'none',
      owner_subject_id: owner.userId,
      status: 'healthy',
    }),
  );
  const capabilities = {
    ...runtimeCapabilities(runtime),
    protocol: 'systemone',
    chat_completions: false,
    json_object: false,
    json_schema: false,
    tools: false,
    streaming: false,
    stream_usage: false,
    schema_keywords: [],
    schema_dialect: null,
    accepted_parameters: [],
  };
  const response = await handleApi(
    new Request(`${config.origin}/v1/model-deployments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerKey}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
      body: JSON.stringify({
        name: 'External SystemOne',
        source: { kind: 'external', capabilities },
        runtime: { kind: 'external', engine: 'kev' },
        hosting: {
          kind: 'external_systemone',
          endpoint_connection_id: connection.id,
          model_alias: 'kev-latest',
          lifecycle: 'external',
          external_hosting_acknowledged: true,
        },
        access: { grants: [] },
      }),
    }),
  );
  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created).toMatchObject({
    desired_state: 'stopped',
    admission_open: false,
    capabilities: null,
    infrastructure_cost: { status: 'external_unknown' },
  });
  const revision = await handleApi(
    new Request(
      `${config.origin}/v1/model-deployments/${created.deployment_id}/revisions/${created.desired_revision_id}`,
      { headers: { authorization: `Bearer ${ownerKey}` } },
    ),
  );
  expect(revision.status).toBe(200);
  expect(await revision.json()).toMatchObject({
    hosting: { kind: 'external_systemone' },
    capabilities,
    source: { kind: 'external', capabilities },
  });
});
afterAll(async () => {
  await Promise.all([pool.end(), authPool.end()]);
});

it.each([
  { protocol: 'openai_chat' as const },
  { chat_completions: true },
  { json_object: true },
  { json_schema: true },
  { tools: true },
  { streaming: true },
  { stream_usage: true },
  { schema_keywords: ['type'] },
  { schema_dialect: 'https://json-schema.org/draft/2020-12/schema' },
])('rejects contradictory external SystemOne capabilities before endpoint access: %j', async (overrides) => {
  await expect(
    prepareRevision(owner, {
      source: {
        kind: 'external',
        capabilities: {
          ...runtimeCapabilities(runtime),
          protocol: 'systemone',
          chat_completions: false,
          json_object: false,
          json_schema: false,
          tools: false,
          streaming: false,
          stream_usage: false,
          schema_keywords: [],
          schema_dialect: null,
          accepted_parameters: [],
          ...overrides,
        },
      },
      runtime: { kind: 'external' },
      hosting: {
        kind: 'external_systemone',
        endpoint_connection_id: id(),
        model_alias: 'kev-latest',
        lifecycle: 'external',
        external_hosting_acknowledged: true,
      },
    }),
  ).rejects.toMatchObject({ status: 422, code: 'unsupported_model_capability' });
});

it('quotes the maximum of every allowed offer, all GPUs/replicas and exact container disk cost', async () => {
  const adapter = provider();
  expect(await quoteManagedService(revision(), policy(), 'fixture-runpod-key', adapter)).toMatchObject({
    gpu_hourly_micro_usd: '9000000',
    disk_hourly_micro_usd: '10000',
    hourly_micro_usd: '9010000',
  });
  expect(adapter.catalog).toHaveBeenCalledWith('fixture-runpod-key');
  expect(adapter.create).not.toHaveBeenCalled();
  await expect(
    quoteManagedService(
      revision(),
      { ...policy(), max_hourly_cost_micro_usd: '9009999' },
      'fixture-runpod-key',
      adapter,
    ),
  ).rejects.toMatchObject({
    status: 402,
    code: 'deployment_budget_exhausted',
    details: { required_hourly_cost_micro_usd: '9010000' },
  });
});

it.each(['missing-pool', 'unknown-rate', 'insufficient-memory', 'unknown-memory'] as const)(
  'rejects an unpriceable or incompatible plan: %s',
  async (condition) => {
    const selected = offers();
    const record = revision();
    if (condition === 'missing-pool') selected.pop();
    if (condition === 'unknown-rate') selected[1].hourly_micro_usd = null;
    if (condition === 'insufficient-memory') selected[1].memory_bytes = '100';
    if (condition === 'unknown-memory') record.source_evidence.memory_estimate_bytes = null;
    const adapter = provider(selected);
    await expect(quoteManagedService(record, policy(), 'fixture-runpod-key', adapter)).rejects.toMatchObject({
      code: 'invalid_hosting_policy',
      status: 422,
    });
    expect(adapter.create).not.toHaveBeenCalled();
  },
);

it('rounds storage bytes exactly beyond JavaScript’s safe integer range', async () => {
  const selected = offers().map((offer) => ({ ...offer, memory_bytes: '9007199500000000' }));
  const record = revision({ source_evidence: { memory_estimate_bytes: '9007199500000001' } });
  const rates = await quoteManagedService(
    record,
    { ...policy(), max_hourly_cost_micro_usd: '8000000000' },
    'fixture-runpod-key',
    provider(selected),
  );
  expect(rates.disk_hourly_micro_usd).toBe('7506000000');
  expect(rates.hourly_micro_usd).toBe('7515000000');
});

it('rejects physical VRAM that does not fit within the selected runtime utilization', async () => {
  const record = revision({ source_evidence: { memory_estimate_bytes: '30000000000' } });
  record.runtime = { ...runtime, parameters: { ...runtime.parameters, gpu_memory_utilization: 0.5 } };
  await expect(quoteManagedService(record, policy(), 'fixture-runpod-key', provider())).rejects.toMatchObject(
    { status: 422, code: 'invalid_hosting_policy' },
  );
  record.source_evidence.memory_estimate_bytes = '24000000000';
  expect(
    await quoteManagedService(
      record,
      { ...policy(), max_hourly_cost_micro_usd: '10000000' },
      'fixture-runpod-key',
      provider(),
    ),
  ).toMatchObject({
    gpu_hourly_micro_usd: '9000000',
  });
});

it('distinguishes a narrowing service policy from increased capacity, rate or operating duration', () => {
  const current = { ...policy(), stop_at: '2030-01-02T00:00:00Z' };
  expect(
    policyExpands(current, {
      ...current,
      max_replicas: 2,
      max_concurrent_requests: 2,
      max_hourly_cost_micro_usd: '8000000',
      stop_at: '2030-01-01T00:00:00Z',
    }),
  ).toBe(false);
  expect(policyExpands(current, { ...current, max_replicas: 4 })).toBe(true);
  expect(policyExpands(current, { ...current, max_hourly_cost_micro_usd: '10000000' })).toBe(true);
  expect(policyExpands(current, { ...current, stop_at: null })).toBe(true);
  expect(() =>
    validateServicePolicy(revision(), { ...policy(), max_concurrent_requests: 7 }, 'running'),
  ).toThrow(expect.objectContaining({ code: 'invalid_hosting_policy' }));
});

async function configured() {
  return transaction(owner.organizationId, async (tx) => {
    const connection = await resources.create(tx, 'connections', owner.organizationId, {
      name: 'Fixture RunPod',
      kind: 'runpod',
      auth_method: 'api_key',
      owner_subject_id: owner.userId,
      secret_ciphertext: seal('fixture-runpod-key'),
      status: 'healthy',
    });
    const record = revision({ organization_id: owner.organizationId });
    record.hosting = {
      kind: 'runpod_serverless',
      compute_connection_id: connection.id,
      placement: { region_ids: ['fixture-region'], gpu_pool_ids: ['pool-a', 'pool-b'], gpu_count: 2 },
    };
    const prepared = {
      source: record.source,
      runtime: record.runtime,
      hosting: record.hosting,
      capabilities: record.capabilities,
      source_evidence: record.source_evidence,
    };
    const created = await deployments.create(
      tx,
      owner,
      { name: 'Fixture warm model', ...prepared, access: { grants: [] } },
      prepared,
    );
    await tx.query(
      "UPDATE model_deployments SET desired_state='running',state='ready',serving_revision_id=desired_revision_id,policy=$2 WHERE id=$1",
      [created.id, JSON.stringify(policy())],
    );
    return { created, connection };
  });
}
function context(
  p: Principal,
  deploymentId: string,
  body: Schema['ModelDeploymentServiceInput'],
): RequestContext {
  return {
    p,
    request: new Request(`${config.origin}/v1/model-deployments/${deploymentId}/service`),
    query: new URLSearchParams(),
    params: { deployment_id: deploymentId },
    body,
    bytes: Buffer.from(JSON.stringify(body)),
    operationId: 'setModelDeploymentService',
    idempotencyKey: id(),
    headers: new Headers(),
    requestId: id(),
  };
}

it('narrows current running capacity without provider discovery and keeps the accepted revision', async () => {
  const { created } = await configured();
  config.allowPaid = true;
  const adapter = provider();
  vi.mocked(adapter.catalog).mockRejectedValue(new Error('Fixture catalog unavailable'));
  const prepared = await prepareService(
    context(owner, created.id, {
      deployment_revision_id: created.desired_revision_id,
      desired_state: 'running',
      policy: { ...policy(), max_replicas: 2, max_concurrent_requests: 2 },
    }),
    adapter,
  );
  const changed = await transaction(owner.organizationId, (tx) => prepared.commit(tx, owner));
  expect(changed).toMatchObject({
    desired_state: 'running',
    serving_revision_id: created.desired_revision_id,
    policy: { max_replicas: 2, max_concurrent_requests: 2 },
  });
  expect(adapter.catalog).not.toHaveBeenCalled();
});

it('accepts an actual HTTP stop with disabled paid execution and unavailable provider credentials', async () => {
  const { created, connection } = await configured();
  config.allowPaid = false;
  await transaction(owner.organizationId, (tx) =>
    resources.update(tx, 'connections', connection.id, { status: 'expired' }),
  );
  const response = await handleApi(
    new Request(`${config.origin}/v1/model-deployments/${created.id}/service`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${ownerKey}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
      body: JSON.stringify({
        deployment_revision_id: created.desired_revision_id,
        desired_state: 'stopped',
        policy: policy(),
      }),
    }),
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({
    deployment_id: created.id,
    desired_state: 'stopped',
    state: 'stopping',
    admission_open: false,
    serving_revision_id: created.desired_revision_id,
  });
});

it('rechecks management authority after the real provider quotation wait and rolls back control changes', async () => {
  const { created } = await configured();
  config.allowPaid = true;
  const issued = await transaction(owner.organizationId, (tx) =>
    createKey(tx, owner, {
      name: 'Temporary service controller',
      scopes: ['model-deployments:read', 'model-deployments:write'],
    }),
  );
  const controller: Principal = { ...owner, id: issued.id, kind: 'api_key', scopes: issued.scopes };
  let entered: (() => void) | undefined, release: ((offers: GpuOffer[]) => void) | undefined;
  const called = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const result = new Promise<GpuOffer[]>((resolve) => {
    release = resolve;
  });
  const adapter = provider();
  vi.mocked(adapter.catalog).mockImplementation(async () => {
    entered?.();
    return result;
  });
  const pending = prepareService(
    context(controller, created.id, {
      deployment_revision_id: created.desired_revision_id,
      desired_state: 'running',
      policy: { ...policy(), max_replicas: 4, max_hourly_cost_micro_usd: '13000000' },
    }),
    adapter,
  );
  await called;
  await transaction(owner.organizationId, (tx) =>
    tx.query('UPDATE api_keys SET revoked_at=clock_timestamp() WHERE id=$1', [controller.id]),
  );
  release?.(offers());
  const prepared = await pending;
  await expect(
    transaction(owner.organizationId, (tx) => prepared.commit(tx, controller)),
  ).rejects.toMatchObject({ code: 'permission_denied' });
  const unchanged = await transaction(owner.organizationId, (tx) =>
    deployments.deploymentRow(tx, created.id),
  );
  expect(unchanged.policy).toMatchObject({ max_replicas: 3 });
  expect(unchanged.generation).toBe('0');
  expect(adapter.create).not.toHaveBeenCalled();
});

it('creates a managed native revision through the public contract, freezing its recipe/image without buying compute', async () => {
  const nativeImage = `fixture/native@sha256:${'b'.repeat(64)}`;
  vi.stubEnv('MODEL_DECISION_SERVING_IMAGE', nativeImage);
  vi.stubEnv('MODEL_SERVING_IMAGE', `fixture/chat@sha256:${'c'.repeat(64)}`);
  const compute = await transaction(owner.organizationId, (tx) =>
    resources.create(tx, 'connections', owner.organizationId, {
      name: 'Native RunPod fixture',
      kind: 'runpod',
      auth_method: 'api_key',
      owner_subject_id: owner.userId,
      secret_ciphertext: seal('private-fixture-provider-key'),
      status: 'healthy',
    }),
  );
  const runtime: Schema['ModelDeploymentRuntime'] = {
    profile_id: 'kev-systemone-v1',
    parameters: {
      context_window_tokens: 8192,
      max_output_tokens: 1024,
      max_concurrent_requests: 4,
      dtype: 'bfloat16',
    },
  };
  const source: Schema['ModelDeploymentHuggingFaceSource'] = {
    kind: 'hugging_face',
    repository: 'fixture/kev',
    revision: 'a'.repeat(40),
    weight_files: ['adapter_model.safetensors'],
    license_acknowledged: true,
  };
  const artifact = { path: 'head.pt', size_bytes: 5000000, sha256: 'd'.repeat(64), git_blob_sha1: null };
  const recipe = {
    format: 'kev' as const,
    version: 1 as const,
    weights: 'lora' as const,
    checkpoint_files: [artifact, { ...artifact, path: 'adapter_model.safetensors' }],
    base: {
      repository: 'fixture/base',
      revision: 'e'.repeat(40),
      files: [{ ...artifact, path: 'model.safetensors' }],
    },
    licenses: [{ repository: 'fixture/kev', revision: 'a'.repeat(40), license: 'apache-2.0', gated: false }],
  };
  const inspect = vi.spyOn(sourceProvider, 'prepareHuggingFaceSource').mockResolvedValue({
    inspection: {
      supported: true,
      findings: [],
      source,
      runtime_profiles: [
        {
          profile_id: 'kev-systemone-v1',
          image: nativeImage,
          parameters: runtime.parameters,
          capabilities: runtimeCapabilities(runtime),
        },
      ],
      hosting_options: [],
      memory_estimate_bytes: '18000000000',
      license: 'apache-2.0',
      license_acknowledgement_required: true,
    },
    nativeRecipe: recipe,
  });
  const response = await handleApi(
    new Request(`${config.origin}/v1/model-deployments`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ownerKey}`,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
      body: JSON.stringify({
        name: 'Managed Kev',
        source,
        runtime,
        hosting: {
          kind: 'runpod_serverless',
          compute_connection_id: compute.id,
          placement: { region_ids: ['fixture-region'], gpu_pool_ids: ['pool-a'], gpu_count: 1 },
        },
        access: { grants: [] },
      }),
    }),
  );
  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created).toMatchObject({ desired_state: 'stopped', admission_open: false });
  expect(inspect).toHaveBeenCalledWith({ source, task: 'decision', runtime_preferences: runtime }, undefined);
  const frozen = await transaction(owner.organizationId, (tx) =>
    deployments.revisionRow(tx, created.deployment_id, created.desired_revision_id),
  );
  expect(frozen).toMatchObject({
    capabilities: { protocol: 'systemone', streaming: false },
    source_evidence: { runtime_image: nativeImage, native_recipe: recipe },
  });
  expect(JSON.stringify(frozen.source_evidence)).not.toContain('private-fixture-provider-key');
  const allocations = await transaction(owner.organizationId, (tx) =>
    tx.query('SELECT id FROM model_deployment_resources WHERE deployment_id=$1', [created.deployment_id]),
  );
  expect(allocations.rows).toEqual([]);
});

it('uses one pool offer with worst memory, complete maximum price and unioned regions for inspection and quotation', async () => {
  const mixed: GpuOffer[] = [
    {
      ...offers()[0],
      pool: 'mixed',
      id: 'gpu-20',
      memory_bytes: (20n * 1024n ** 3n).toString(),
      hourly_micro_usd: '1000000',
      region_ids: ['region-a'],
    },
    {
      ...offers()[0],
      pool: 'mixed',
      id: 'gpu-16',
      memory_bytes: (16n * 1024n ** 3n).toString(),
      hourly_micro_usd: '1200000',
      region_ids: ['region-b'],
    },
  ];
  expect(modelHostingPools(mixed)).toEqual([
    {
      pool: 'mixed',
      name: 'mixed (at least 16 GiB per GPU)',
      memory_bytes: (16n * 1024n ** 3n).toString(),
      hourly_micro_usd: '1200000',
      region_ids: ['region-a', 'region-b'],
    },
  ]);
  const record = revision();
  record.hosting = {
    kind: 'runpod_serverless',
    compute_connection_id: id(),
    placement: { region_ids: [], gpu_pool_ids: ['mixed'], gpu_count: 1 },
  };
  record.source_evidence.memory_estimate_bytes = (18n * 1024n ** 3n).toString();
  await expect(quoteManagedService(record, policy(), 'fixture-key', provider(mixed))).rejects.toMatchObject({
    code: 'invalid_hosting_policy',
  });
  mixed[1].hourly_micro_usd = null;
  expect(modelHostingPools(mixed)[0].hourly_micro_usd).toBeNull();
  record.source_evidence.memory_estimate_bytes = '1000000000';
  await expect(quoteManagedService(record, policy(), 'fixture-key', provider(mixed))).rejects.toMatchObject({
    code: 'invalid_hosting_policy',
  });
});
