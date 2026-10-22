import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { transaction, pool, authPool } from '../../packages/db';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { config } from '../../packages/core/src/config';
import { canonical, id, unseal } from '../../packages/core/src/crypto';
import { saveConnection } from '../../packages/core/src/connections';
import * as resources from '../../packages/core/src/resources';
import * as deployments from '../../packages/core/src/model-deployments';
import { runtimeCapabilities } from '../../packages/core/src/model-deployment-profiles';
import { advanceModelDeployment } from '../../packages/core/src/model-deployment-reconciler';
import { prepareConnectionSave } from '../../packages/core/src/model-hosting-connections';
import { prepareService } from '../../packages/core/src/model-deployment-service';
import type { RequestContext } from '../../packages/core/src/api-types';
import type {
  DeploymentResourceRow,
  ModelHostingProvider,
  ServingObservation,
} from '../../packages/core/src/model-deployment-types';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
const originalPaid = config.allowPaid;
let computeId: string;
let deploymentId: string;
let revisionId: string;
let provider: FixtureProvider;
const org = () => account.p.organizationId;
const image = `fixture/model-serving@sha256:${'a'.repeat(64)}`;
const policy = {
  min_replicas: 1,
  max_replicas: 2,
  max_concurrent_requests: 4,
  max_hourly_cost_micro_usd: '10000000',
  stop_at: null,
};

class FixtureProvider implements ModelHostingProvider {
  entries = new Map<string, ServingObservation>();
  creates = 0;
  deletes = 0;
  inspected: string[] = [];
  deleted: string[] = [];
  updates: Record<string, unknown>[] = [];
  lostCreate = false;
  inventoryEmpty = false;
  failPatch = false;
  failInspect = false;
  lostDelete = false;
  amount = '100';
  costMode: 'reported' | 'empty' | 'failure' = 'reported';
  costCalls: { providerId: string; start: string; end: string }[] = [];
  deleteKey = 'synthetic-compute-secret';
  onCreate?: () => Promise<void>;
  async catalog() {
    return [
      {
        id: 'gpu',
        pool: 'ADA_24',
        name: 'Fixture GPU',
        memory_bytes: '25769803776',
        hourly_micro_usd: '1000000',
        region_ids: ['US-KS-2'],
      },
    ];
  }
  async create(_secret: string, payload: Record<string, unknown>) {
    this.creates++;
    await this.onCreate?.();
    const providerId = `endpoint-${this.creates}`;
    const endpoint = `https://${providerId}.api.runpod.ai`;
    this.entries.set(providerId, {
      id: providerId,
      endpoint_url: endpoint,
      ready_replicas: 1,
      workers: [
        {
          id: `worker-${this.creates}`,
          pool: 'ADA_24',
          started_at: new Date().toISOString(),
          stopped_at: null,
        },
      ],
      config: { ...payload, observed_workers: [{ gpuTypeId: 'gpu', gpuCount: 1 }] },
    });
    if (this.lostCreate) throw new Error('Synthetic lost create acknowledgment');
    return { id: providerId, endpoint_url: endpoint };
  }
  async inspect(secret: string, providerId: string) {
    this.inspected.push(providerId);
    if (secret === 'different-account') return null;
    if (this.failInspect) throw new Error('Synthetic provider observation failure');
    return this.entries.get(providerId) ?? null;
  }
  async findAttempt(_secret: string, attemptId: string) {
    return this.inventoryEmpty
      ? []
      : [...this.entries.values()]
          .filter((entry) => {
            const env = entry.config.env;
            return (
              env && typeof env === 'object' && 'MF_ATTEMPT_ID' in env && env.MF_ATTEMPT_ID === attemptId
            );
          })
          .map((entry) => ({ id: entry.id, endpoint_url: entry.endpoint_url }));
  }
  async update(_secret: string, providerId: string, patch: Record<string, unknown>) {
    this.updates.push(patch);
    if (this.failPatch) throw new Error('Synthetic scale-down failure');
    const entry = this.entries.get(providerId);
    if (entry) entry.config = { ...entry.config, ...patch };
  }
  async delete(secret: string, providerId: string) {
    expect(secret).toBe(this.deleteKey);
    this.deletes++;
    this.deleted.push(providerId);
    this.entries.delete(providerId);
    if (this.lostDelete) throw new Error('Synthetic lost delete acknowledgment');
  }
  async costs(_secret: string, providerId: string, start: string, end: string) {
    this.costCalls.push({ providerId, start, end });
    if (this.costMode === 'failure') throw new Error('Synthetic billing observation failure');
    if (this.costMode === 'empty') return [];
    const bucket = Math.floor(Date.parse(start) / 3_600_000) * 3_600_000;
    return [
      {
        start: new Date(bucket).toISOString(),
        end: new Date(bucket + 3_600_000).toISOString(),
        micro_usd: this.amount,
      },
    ];
  }
}

const runtime = {
  profile_id: 'vllm-0.32.0-text' as const,
  parameters: { context_window_tokens: 4096, max_output_tokens: 512, max_concurrent_requests: 4 },
};
function prepared(commit = 'a'.repeat(40)): deployments.PreparedDeploymentRevision {
  return {
    source: {
      kind: 'hugging_face',
      repository: 'fixture/model',
      revision: commit,
      weight_files: ['model.safetensors'],
      chat_template: 'tokenizer',
    },
    runtime,
    hosting: {
      kind: 'runpod_serverless',
      compute_connection_id: computeId,
      placement: { region_ids: ['US-KS-2'], gpu_pool_ids: ['ADA_24'], gpu_count: 1 },
    },
    capabilities: runtimeCapabilities(runtime),
    source_evidence: { runtime_image: image, memory_estimate_bytes: '1000000000' },
  };
}
async function due(expireLease = false) {
  await transaction(org(), async (tx) => {
    await tx.query(
      `UPDATE model_deployments SET next_check_at=now()-interval '1 second'${expireLease ? ",lease_until=now()-interval '1 second'" : ''} WHERE id=$1`,
      [deploymentId],
    );
  });
}
async function advance() {
  await due();
  return advanceModelDeployment(org(), deploymentId, provider);
}
async function row() {
  return transaction(org(), (tx) => deployments.deploymentRow(tx, deploymentId));
}
async function resource() {
  return transaction(
    org(),
    async (tx) =>
      (
        await tx.query<DeploymentResourceRow>(
          'SELECT * FROM model_deployment_resources WHERE deployment_id=$1 ORDER BY created_at DESC LIMIT 1',
          [deploymentId],
        )
      ).rows[0],
  );
}
async function costsDue() {
  await transaction(org(), (tx) =>
    tx.query(
      "UPDATE model_deployment_resources SET cost_checked_at=now()-interval '6 minutes' WHERE deployment_id=$1",
      [deploymentId],
    ),
  );
}
async function stopIntent() {
  await transaction(org(), async (tx) => {
    await tx.query(
      "UPDATE model_deployments SET desired_state='stopped',state='stopping',generation=generation+1,next_check_at=now() WHERE id=$1",
      [deploymentId],
    );
  });
}

function rotationContext(secret = 'rotated-same-account'): RequestContext {
  const body = { secret };
  return {
    p: account.p,
    request: new Request(`${config.origin}/v1/connections/${computeId}`),
    query: new URLSearchParams(),
    params: { connection_id: computeId },
    body,
    bytes: Buffer.from(JSON.stringify(body)),
    operationId: 'updateConnection',
    idempotencyKey: id(),
    headers: new Headers(),
    requestId: id(),
  };
}

beforeAll(async () => {
  account = await fixtureAccount('Model lifecycle owner');
});
beforeEach(async () => {
  config.allowPaid = true;
  provider = new FixtureProvider();
  const connection = await transaction(org(), (tx) =>
    saveConnection(tx, account.p, {
      name: 'Fixture hosting',
      kind: 'runpod',
      provider: 'runpod',
      auth_method: 'api_key',
      secret: 'synthetic-compute-secret',
    }),
  );
  computeId = connection.id;
  const revision = prepared();
  const created = await transaction(org(), (tx) =>
    deployments.create(
      tx,
      account.p,
      {
        name: 'Fixture model',
        source: revision.source,
        runtime: revision.runtime,
        hosting: revision.hosting,
        access: { grants: [] },
      },
      revision,
    ),
  );
  deploymentId = created.id;
  revisionId = created.desired_revision_id;
  await transaction(org(), async (tx) => {
    await tx.query(
      "UPDATE model_deployments SET desired_state='running',policy=$2,state='starting',startup_at=now(),next_check_at=now() WHERE id=$1",
      [deploymentId, JSON.stringify(policy)],
    );
  });
});
afterEach(async () => {
  config.allowPaid = originalPaid;
  await retireFixtureRuns(org());
  await transaction(org(), async (tx) => {
    await tx.query(
      "UPDATE model_deployments SET desired_state='stopped',state='stopped',lease_id=NULL,lease_until=NULL WHERE id=$1",
      [deploymentId],
    );
  });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

describe('persistent model service reconciliation', () => {
  it('keeps quiescent metadata out of the due index while admitting pending cleanup', async () => {
    await advance();
    await stopIntent();
    provider.failInspect = true;
    await advance();
    const quiescent = Array.from({ length: 1000 }, () => ({ deployment: id(), revision: id() }));
    await transaction(org(), async (tx) => {
      await tx.query(
        `INSERT INTO model_deployments(id,organization_id,owner_subject_id,name)
        SELECT d.deployment,$1,$2,'Stopped discovery fixture' FROM jsonb_to_recordset($3::jsonb) AS d(deployment uuid)`,
        [org(), account.p.userId, JSON.stringify(quiescent)],
      );
      await tx.query(
        `INSERT INTO model_deployment_revisions(id,organization_id,deployment_id,source,runtime,hosting,capabilities,source_evidence)
        SELECT d.revision,$1,d.deployment,r.source,r.runtime,r.hosting,r.capabilities,r.source_evidence
        FROM jsonb_to_recordset($3::jsonb) AS d(deployment uuid,revision uuid),model_deployment_revisions r WHERE r.id=$2`,
        [org(), revisionId, JSON.stringify(quiescent)],
      );
      await tx.query(
        `UPDATE model_deployments SET desired_revision_id=d.revision
        FROM jsonb_to_recordset($1::jsonb) AS d(deployment uuid,revision uuid) WHERE id=d.deployment`,
        [JSON.stringify(quiescent)],
      );
      const idle = await tx.query<{ count: string }>(
        'SELECT count(*) FROM model_deployments WHERE id=ANY($1::uuid[]) AND next_check_at IS NULL',
        [quiescent.map((value) => value.deployment)],
      );
      expect(idle.rows[0].count).toBe('1000');
      await tx.query('UPDATE model_deployments SET next_check_at=now() WHERE id=$1', [deploymentId]);
    });
    const candidates = await pool.query<{ id: string }>(
      `SELECT id FROM reporting.model_deployment_dispatch WHERE next_check_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_check_at,id LIMIT 20`,
    );
    expect(candidates.rows.map((value) => value.id)).toContain(deploymentId);
    expect(candidates.rows.some((value) => quiescent.some((idle) => idle.deployment === value.id))).toBe(
      false,
    );
    const plan = await pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT id FROM reporting.model_deployment_dispatch WHERE next_check_at<=now()
      AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_check_at,id LIMIT 20`,
    );
    expect(plan.rows.map((value) => value['QUERY PLAN']).join('\n')).toContain('model_deployments_due');
  });

  it('commits the only create permit before provider I/O and fences concurrent reconcilers', async () => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.onCreate = async () => {
      const pending = await resource();
      expect(pending.state).toBe('creating');
      expect(pending.provider_id).toBeNull();
      expect(unseal<string>(pending.cleanup_secret_ciphertext || '')).toBe('synthetic-compute-secret');
      entered();
      await held;
    };
    const first = advanceModelDeployment(org(), deploymentId, provider);
    await ready;
    expect(await advanceModelDeployment(org(), deploymentId, provider)).toBe(false);
    release();
    expect(await first).toBe(true);
    await advance();
    expect((await row()).state).toBe('ready');
    expect(provider.creates).toBe(1);
    const safe = JSON.stringify((await resource()).config);
    expect(safe).not.toContain('synthetic-compute-secret');
    expect(safe).not.toContain('MF_ENDPOINT_SECRET');
  });

  it('adopts a uniquely matched lost create and never dispatches a second create', async () => {
    provider.lostCreate = true;
    await advance();
    expect((await resource()).state).toBe('ambiguous');
    await advance();
    expect((await row()).serving_revision_id).toBeNull();
    expect((await resource()).provider_id).toBe('endpoint-1');
    await advance();
    expect((await row()).state).toBe('ready');
    expect(provider.creates).toBe(1);
  });

  it('retains ambiguous empty inventory instead of assuming absence and purchasing again', async () => {
    provider.lostCreate = true;
    await advance();
    provider.inventoryEmpty = true;
    await advance();
    await advance();
    expect((await row()).state).toBe('cleanup_pending');
    expect((await resource()).provider_id).toBeNull();
    expect(provider.creates).toBe(1);
  });

  it('durably cleans duplicate exact attempts one endpoint per pass without adopting or recreating', async () => {
    provider.lostCreate = true;
    await advance();
    const first = provider.entries.get('endpoint-1');
    if (!first) throw new Error('Expected the lost-create fixture endpoint.');
    provider.entries.set('duplicate', { ...structuredClone(first), id: 'duplicate' });
    await stopIntent();
    // The inventory pass never adds destructive calls to its 60s I/O budget.
    await advance();
    expect(provider.inspected).toEqual([]);
    expect(provider.deleted).toEqual([]);
    expect((await resource()).config.cleanup_candidates).toEqual([
      { id: 'endpoint-1', state: 'pending' },
      { id: 'duplicate', state: 'pending' },
    ]);
    config.allowPaid = false;
    provider.failPatch = true;
    provider.lostDelete = true;
    await advance();
    expect(provider.deleted).toEqual(['endpoint-1']);
    expect((await resource()).deleted_at).toBeNull();
    expect((await row()).state).toBe('cleanup_pending');
    await advance();
    expect(provider.deleted).toEqual(['endpoint-1', 'duplicate']);
    expect((await resource()).deleted_at).toBeNull();
    await advance();
    expect((await resource()).deleted_at).toBeNull();
    await advance();
    expect((await resource()).deleted_at).not.toBeNull();
    expect((await resource()).cleanup_secret_ciphertext).toBeNull();
    expect((await row()).state).toBe('stopped');
    expect((await row()).serving_revision_id).toBeNull();
    expect(provider.creates).toBe(1);
  });

  it('never deletes an attempt-tag collision with another immutable recipe and still cleans verified duplicates', async () => {
    provider.lostCreate = true;
    await advance();
    const first = provider.entries.get('endpoint-1');
    if (!first) throw new Error('Expected the lost-create fixture endpoint.');
    const foreign = structuredClone(first);
    foreign.id = 'foreign';
    foreign.config.image = `foreign/runtime@sha256:${'b'.repeat(64)}`;
    provider.entries = new Map([
      ['foreign', foreign],
      ['endpoint-1', first],
      ['duplicate', { ...structuredClone(first), id: 'duplicate' }],
    ]);
    await advance();
    expect((await row()).state).toBe('cleanup_pending');
    expect((await resource()).provider_id).toBeNull();
    await stopIntent();
    await advance();
    expect(provider.deleted).toEqual([]);
    await advance();
    await advance();
    expect(provider.deleted).toEqual(['endpoint-1', 'duplicate']);
    expect(provider.entries.has('foreign')).toBe(true);
    expect((await resource()).deleted_at).toBeNull();
    expect((await resource()).cleanup_secret_ciphertext).not.toBeNull();
    expect((await row()).state).toBe('cleanup_pending');
    expect((await row()).serving_revision_id).toBeNull();
    expect(provider.creates).toBe(1);
  });

  it('retains duplicate cleanup until each provider endpoint is confirmed absent', async () => {
    provider.lostCreate = true;
    await advance();
    const first = provider.entries.get('endpoint-1');
    if (!first) throw new Error('Expected the lost-create fixture endpoint.');
    provider.entries.set('duplicate', { ...structuredClone(first), id: 'duplicate' });
    await advance();
    await stopIntent();
    const deleteEndpoint = provider.delete.bind(provider);
    provider.delete = async (_key, providerId) => {
      provider.deleted.push(providerId);
      provider.deletes++;
      throw new Error('Synthetic unsuccessful delete');
    };
    await advance();
    expect((await resource()).deleted_at).toBeNull();
    expect((await row()).state).toBe('cleanup_pending');
    expect(provider.entries.has('endpoint-1')).toBe(true);
    provider.delete = deleteEndpoint;
    await advance();
    expect((await resource()).deleted_at).toBeNull();
    await advance();
    expect((await resource()).deleted_at).toBeNull();
    await advance();
    expect((await resource()).deleted_at).toBeNull();
    await advance();
    expect((await resource()).deleted_at).not.toBeNull();
    expect((await row()).state).toBe('stopped');
  });

  it('retains a late create identity after stop without reopening service and cleans with paid execution disabled', async () => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.onCreate = async () => {
      entered();
      await held;
    };
    const first = advanceModelDeployment(org(), deploymentId, provider);
    await ready;
    await stopIntent();
    release();
    await first;
    expect((await row()).serving_revision_id).toBeNull();
    expect((await resource()).provider_id).toBe('endpoint-1');
    config.allowPaid = false;
    // The stale create owner releases its exact lease when it finishes. A stop
    // must not wait for the old 120s lease to expire before owned cleanup.
    expect((await row()).lease_id).toBeNull();
    await advanceModelDeployment(org(), deploymentId, provider);
    expect((await row()).state).toBe('stopped');
    expect((await resource()).cleanup_secret_ciphertext).toBeNull();
    expect(provider.deletes).toBe(1);
  });

  it('cannot release a replacement lease after its own provider call finishes late', async () => {
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    provider.onCreate = async () => {
      entered();
      await held;
    };
    const first = advanceModelDeployment(org(), deploymentId, provider);
    await ready;
    const successor = id();
    try {
      await transaction(org(), (tx) =>
        tx.query(
          "UPDATE model_deployments SET lease_id=$2,lease_until=now()+interval '2 minutes',next_check_at=now()+interval '1 minute' WHERE id=$1",
          [deploymentId, successor],
        ),
      );
    } finally {
      release();
      await first;
    }
    const current = await row();
    expect(current.lease_id).toBe(successor);
    expect(current.lease_until?.getTime()).toBeGreaterThan(Date.now());
    expect(current.next_check_at?.getTime()).toBeGreaterThan(Date.now());
    expect((await resource()).provider_id).toBe('endpoint-1');
  });

  it('cleans owned infrastructure after connection disconnect erased ordinary credentials and scale-down failed', async () => {
    await advance();
    await advance();
    expect(provider.costCalls).toHaveLength(1);
    await stopIntent();
    await transaction(org(), (tx) =>
      resources.update(tx, 'connections', computeId, {
        deleted: true,
        status: 'error',
        secret_ciphertext: null,
      }),
    );
    provider.failPatch = true;
    provider.lostDelete = true;
    provider.amount = '250';
    await advance();
    expect(provider.deletes).toBe(1);
    expect((await resource()).deleted_at).not.toBeNull();
    expect((await row()).state).toBe('stopped');
    expect(provider.costCalls).toHaveLength(2);
    const observed = await transaction(org(), (tx) =>
      tx.query<{ amount: string }>(
        `SELECT provider_reported_micro_usd AS amount FROM model_deployment_cost_observations
      WHERE resource_id=(SELECT id FROM model_deployment_resources WHERE deployment_id=$1)`,
        [deploymentId],
      ),
    );
    expect(observed.rows).toEqual([{ amount: '250' }]);
    await advance();
    expect(provider.costCalls).toHaveLength(2);
  });

  it('preserves cleanup uncertainty when provider shutdown cannot be observed', async () => {
    await advance();
    await advance();
    await stopIntent();
    provider.failInspect = true;
    await advance();
    expect(provider.deletes).toBe(1);
    expect((await row()).state).toBe('cleanup_pending');
    expect((await resource()).deleted_at).toBeNull();
    provider.failInspect = false;
    await advance();
    expect((await resource()).deleted_at).not.toBeNull();
  });

  it('recovers the same revision after worker replacement without invalidating deployment identity', async () => {
    await advance();
    await advance();
    const entry = provider.entries.get('endpoint-1');
    if (!entry) throw new Error('Expected the created fixture endpoint.');
    entry.ready_replicas = 0;
    await advance();
    expect((await row()).state).toBe('degraded');
    entry.ready_replicas = 1;
    entry.workers = [
      { id: 'replacement-worker', pool: 'ADA_24', started_at: new Date().toISOString(), stopped_at: null },
    ];
    await advance();
    expect((await row()).serving_revision_id).toBe(revisionId);
    expect(provider.creates).toBe(1);
  });

  it('closes admission and cleans up unaccepted actual GPUs without trusting intended pools', async () => {
    await advance();
    await advance();
    const entry = provider.entries.get('endpoint-1');
    if (!entry) throw new Error('Expected the created fixture endpoint.');
    entry.config.observed_workers = [{ gpuTypeId: 'unaccepted-expensive-gpu', gpuCount: 1 }];
    await advance();
    expect((await row()).state).toBe('failed');
    expect((await row()).serving_revision_id).toBeNull();
    await advance();
    expect(provider.deletes).toBe(1);
    expect((await resource()).deleted_at).not.toBeNull();
    expect(provider.creates).toBe(1);
  });

  it('accepts an equivalent current pool alternative without requiring the preferred region', async () => {
    const offers = await provider.catalog();
    provider.catalog = async () => [
      ...offers,
      { ...offers[0], id: 'equivalent-gpu', region_ids: ['OTHER-REGION'] },
    ];
    await advance();
    const entry = provider.entries.get('endpoint-1');
    if (!entry) throw new Error('Expected the created fixture endpoint.');
    entry.config.observed_workers = [
      { gpuTypeId: 'equivalent-gpu', gpuCount: 1, dataCenterId: 'OTHER-REGION' },
    ];
    await advance();
    expect((await row()).state).toBe('ready');
    expect((await row()).serving_revision_id).toBe(revisionId);
    expect(provider.creates).toBe(1);
    expect(provider.deletes).toBe(0);
  });

  it.each(['price', 'memory', 'count'])(
    'closes admission when current %s evidence violates accepted policy',
    async (changed) => {
      await advance();
      await advance();
      const offers = await provider.catalog();
      if (changed === 'price')
        provider.catalog = async () => offers.map((offer) => ({ ...offer, hourly_micro_usd: '10000000' }));
      if (changed === 'memory')
        provider.catalog = async () => offers.map((offer) => ({ ...offer, memory_bytes: '1' }));
      if (changed === 'count') {
        const entry = provider.entries.get('endpoint-1');
        if (!entry) throw new Error('Expected the created fixture endpoint.');
        entry.config.observed_workers = [{ gpuTypeId: 'gpu', gpuCount: 2 }];
      }
      await advance();
      expect((await row()).state).toBe('failed');
      expect((await row()).serving_revision_id).toBeNull();
      await advance();
      expect(provider.deletes).toBe(1);
      expect((await resource()).deleted_at).not.toBeNull();
    },
  );

  it('reconciles request capacity without changing the immutable model or worker count', async () => {
    await advance();
    await advance();
    await transaction(org(), async (tx) => {
      await tx.query(
        "UPDATE model_deployments SET policy=jsonb_set(policy,'{max_concurrent_requests}','2'::jsonb),generation=generation+1 WHERE id=$1",
        [deploymentId],
      );
    });
    await advance();
    expect(provider.updates.at(-1)).toMatchObject({
      workers: { min: 1, max: 2 },
      scaling: { type: 'REQUEST_COUNT', requestCount: 2 },
      timeout: 240_000,
    });
    expect((await row()).state).toBe('ready');
    expect(provider.creates).toBe(1);
  });

  it('drains old accepted work before a revision change, then cancels only after the existing deadline allowance', async () => {
    await advance();
    await advance();
    const next = await transaction(org(), (tx) =>
      deployments.addRevision(tx, account.p, deploymentId, prepared('b'.repeat(40))),
    );
    const runId = id();
    await transaction(org(), async (tx) => {
      const project = await resources.create(tx, 'workspaces', org(), { name: 'Lifecycle fixture' });
      await tx.query(
        "INSERT INTO runs(id,organization_id,workspace_id,kind,status,config,deadline) VALUES($1,$2,$3,'inference','running',$4,now()+interval '4 minutes')",
        [
          runId,
          org(),
          project.id,
          JSON.stringify({
            executor_version: '1',
            definition: {},
            context: {},
            deployment_target: { deployment_id: deploymentId, deployment_revision_id: revisionId },
          }),
        ],
      );
      await tx.query(
        "UPDATE model_deployments SET desired_revision_id=$2,generation=generation+1,state='starting',drain_started_at=now() WHERE id=$1",
        [deploymentId, next.deployment_revision_id],
      );
    });
    await advance();
    expect(provider.deletes).toBe(0);
    expect(provider.creates).toBe(1);
    await transaction(org(), async (tx) => {
      await tx.query(
        "UPDATE model_deployments SET drain_started_at=now()-interval '271 seconds' WHERE id=$1",
        [deploymentId],
      );
    });
    await advance();
    expect(provider.deletes).toBe(1);
    expect(
      (
        await transaction(org(), (tx) =>
          tx.query<{ cancel_requested: boolean }>('SELECT cancel_requested FROM runs WHERE id=$1', [runId]),
        )
      ).rows[0].cancel_requested,
    ).toBe(true);
    await advance();
    await advance();
    expect((await row()).serving_revision_id).toBe(next.deployment_revision_id);
    expect(provider.creates).toBe(2);
  });

  it('upserts provider resource/time corrections without duplicating costs or inventing estimates', async () => {
    await advance();
    await advance();
    provider.amount = '75';
    await costsDue();
    await advance();
    // Query by the fixture resource through its tenant, independently of provider totals.
    const observed = await transaction(org(), (tx) =>
      tx.query<{ provider_reported_micro_usd: string; estimated_micro_usd: string | null }>(
        'SELECT provider_reported_micro_usd,estimated_micro_usd FROM model_deployment_cost_observations WHERE resource_id=(SELECT id FROM model_deployment_resources WHERE deployment_id=$1)',
        [deploymentId],
      ),
    );
    expect(observed.rows).toEqual([{ provider_reported_micro_usd: '75', estimated_micro_usd: null }]);
  });

  it.each(['reported', 'empty', 'failure'] as const)(
    'keeps readiness checks independent of the five-minute %s billing cadence',
    async (mode) => {
      await advance();
      provider.costMode = mode;
      await advance();
      expect(provider.costCalls).toHaveLength(1);
      await advance();
      expect((await row()).state).toBe('ready');
      expect(provider.costCalls).toHaveLength(1);
      provider.costMode = 'reported';
      provider.amount = '175';
      await costsDue();
      await advance();
      expect(provider.costCalls).toHaveLength(2);
      const observed = await transaction(org(), (tx) =>
        tx.query<{ amount: string }>(
          `SELECT provider_reported_micro_usd AS amount FROM model_deployment_cost_observations
        WHERE resource_id=(SELECT id FROM model_deployment_resources WHERE deployment_id=$1)`,
          [deploymentId],
        ),
      );
      expect(observed.rows).toEqual([{ amount: '175' }]);
    },
  );

  it('refreshes delayed billing corrections after confirmed cleanup without retaining the cleanup credential', async () => {
    await advance();
    await advance();
    await stopIntent();
    await advance();
    const deletedAt = (await resource()).deleted_at;
    if (!deletedAt) throw new Error('Expected confirmed cleanup.');
    expect((await resource()).cleanup_secret_ciphertext).toBeNull();
    provider.amount = '175';
    await costsDue();
    await advance();
    expect(provider.costCalls.at(-1)?.end).toBe(deletedAt.toISOString());
    expect((await row()).next_check_at?.getTime()).toBeGreaterThan(Date.now() + 290_000);
    const facts = await transaction(org(), (tx) =>
      tx.query<{ provider_reported_micro_usd: string; estimated_micro_usd: string | null }>(
        `SELECT provider_reported_micro_usd,estimated_micro_usd FROM model_deployment_cost_observations
      WHERE resource_id=(SELECT id FROM model_deployment_resources WHERE deployment_id=$1)`,
        [deploymentId],
      ),
    );
    expect(facts.rows).toEqual([{ provider_reported_micro_usd: '175', estimated_micro_usd: null }]);
    expect(provider.creates).toBe(1);
    expect(provider.deletes).toBe(1);
  });

  it('stops polling deleted resources beyond the bounded billing observation window without erasing costs', async () => {
    await advance();
    await advance();
    await stopIntent();
    await advance();
    const costCalls = provider.costCalls.length;
    await transaction(org(), (tx) =>
      tx.query(
        `UPDATE model_deployment_resources SET created_at=now()-interval '32 days',
      deleted_at=now()-interval '31 days',cost_checked_at=now()-interval '6 minutes' WHERE deployment_id=$1`,
        [deploymentId],
      ),
    );
    await advance();
    expect(provider.costCalls).toHaveLength(costCalls);
    expect((await row()).next_check_at).toBeNull();
    const observations = await transaction(org(), (tx) =>
      tx.query<{ amount: string }>(
        `SELECT c.provider_reported_micro_usd AS amount FROM model_deployment_cost_observations c
      JOIN model_deployment_resources r ON r.id=c.resource_id WHERE r.deployment_id=$1`,
        [deploymentId],
      ),
    );
    expect(observations.rows).toEqual([{ amount: '100' }]);
  });

  it('bounds a failed model load and keeps cleanup progressing after recovery is exhausted', async () => {
    await advance();
    const entry = provider.entries.get('endpoint-1');
    if (!entry) throw new Error('Expected fixture endpoint.');
    entry.ready_replicas = 0;
    await transaction(org(), async (tx) => {
      await tx.query("UPDATE model_deployments SET startup_at=now()-interval '21 minutes' WHERE id=$1", [
        deploymentId,
      ]);
    });
    await advance();
    expect((await row()).failure_code).toBe('service_recovery_exhausted');
    await advance();
    await advance();
    expect((await row()).state).toBe('failed');
    expect((await resource()).deleted_at).not.toBeNull();
    expect(provider.creates).toBe(1);
  });

  it('gives an explicit owner retry a fresh startup window after exhausted loading', async () => {
    await advance();
    const failed = provider.entries.get('endpoint-1');
    if (!failed) throw new Error('Expected fixture endpoint.');
    failed.ready_replicas = 0;
    await transaction(org(), (tx) =>
      tx.query("UPDATE model_deployments SET startup_at=now()-interval '21 minutes' WHERE id=$1", [
        deploymentId,
      ]),
    );
    await advance();
    await advance();
    expect((await resource()).deleted_at).not.toBeNull();
    expect((await row()).failure_code).toBe('service_recovery_exhausted');
    const body = { deployment_revision_id: revisionId, desired_state: 'running', policy };
    const context: RequestContext = {
      ...rotationContext(),
      request: new Request(`${config.origin}/v1/model-deployments/${deploymentId}/service`),
      params: { deployment_id: deploymentId },
      body,
      bytes: Buffer.from(JSON.stringify(body)),
      operationId: 'setModelDeploymentService',
    };
    const prepared = await prepareService(context, provider);
    await transaction(org(), (tx) => prepared.commit(tx, account.p));
    await advance();
    const replacement = provider.entries.get('endpoint-2');
    if (!replacement) throw new Error('Expected replacement endpoint.');
    replacement.ready_replicas = 0;
    await advance();
    expect(await row()).toMatchObject({ state: 'starting', failure_code: 'model_loading' });
    expect(provider.creates).toBe(2);
    expect(provider.deletes).toBe(1);
  });

  it('probes an external model without generation and stops access without deleting its host', async () => {
    await stopIntent();
    const caps = runtimeCapabilities(runtime);
    const endpoint = await transaction(org(), (tx) =>
      resources.create(tx, 'connections', org(), {
        name: 'Fixture external',
        kind: 'external_model',
        provider: 'external_openai',
        auth_method: 'none',
        url: 'https://fixture.invalid/v1',
        owner_subject_id: account.p.userId,
        status: 'healthy',
      }),
    );
    const external: deployments.PreparedDeploymentRevision = {
      source: { kind: 'external', capabilities: caps },
      runtime: { kind: 'external' },
      hosting: {
        kind: 'external_openai',
        endpoint_connection_id: endpoint.id,
        model_alias: 'external-fixture',
        lifecycle: 'external',
        external_hosting_acknowledged: true,
      },
      capabilities: caps,
      source_evidence: { endpoint_url: 'https://fixture.invalid/v1' },
    };
    const created = await transaction(org(), (tx) =>
      deployments.create(
        tx,
        account.p,
        {
          name: 'External fixture',
          source: external.source,
          runtime: external.runtime,
          hosting: external.hosting,
          access: { grants: [] },
        },
        external,
      ),
    );
    deploymentId = created.id;
    revisionId = created.desired_revision_id;
    await transaction(org(), async (tx) => {
      await tx.query(
        "UPDATE model_deployments SET desired_state='running',state='starting',policy=$2,next_check_at=now() WHERE id=$1",
        [deploymentId, JSON.stringify({ max_concurrent_requests: 2 })],
      );
    });
    let probes = 0;
    const passive: typeof import('../../packages/providers/src/network').modelEndpointFetch = async (
      url,
      options,
    ) => {
      expect(String(url)).toBe('https://fixture.invalid/v1/models');
      expect(options.method).toBe('GET');
      probes++;
      return Response.json({ data: [{ id: 'external-fixture' }] });
    };
    await advanceModelDeployment(org(), deploymentId, provider, passive);
    expect((await row()).state).toBe('ready');
    await stopIntent();
    await due();
    await advanceModelDeployment(org(), deploymentId, provider, passive);
    expect((await row()).state).toBe('stopped');
    expect(probes).toBe(1);
    expect(provider.creates).toBe(0);
    expect(provider.deletes).toBe(0);
  });

  it('does not let a rotated credential from another account erase the known owned host', async () => {
    await advance();
    await advance();
    await transaction(org(), (tx) =>
      saveConnection(tx, account.p, { secret: 'different-account' }, computeId),
    );
    await advance();
    expect((await resource()).deleted_at).toBeNull();
    expect(canonical((await resource()).config)).not.toContain('different-account');
    await advance();
    expect(provider.deletes).toBe(1);
    expect((await resource()).deleted_at).not.toBeNull();
  });

  it('rotates a positively verified same-account key and cleanup credential atomically', async () => {
    await advance();
    await advance();
    const prepared = await prepareConnectionSave(rotationContext(), provider);
    await transaction(org(), (tx) => prepared.commit(tx, account.p));
    expect(unseal<string>((await resource()).cleanup_secret_ciphertext || '')).toBe('rotated-same-account');
    provider.deleteKey = 'rotated-same-account';
    await stopIntent();
    await advance();
    expect((await resource()).deleted_at).not.toBeNull();
    expect((await resource()).cleanup_secret_ciphertext).toBeNull();
  });

  it.each([false, true])(
    'bounds account rotation inspections to four and drains them before settling (failure=%s)',
    async (failFirst) => {
      await advance();
      const peers: string[] = [];
      for (let index = 0; index < 8; index++) {
        const peer = await transaction(org(), async (tx) => {
          const revision = prepared();
          const created = await deployments.create(
            tx,
            account.p,
            { name: 'Shared account rotation fixture', ...revision, access: { grants: [] } },
            revision,
          );
          await tx.query(
            "UPDATE model_deployments SET desired_state='running',policy=$2,state='starting',startup_at=now(),next_check_at=now() WHERE id=$1",
            [created.id, JSON.stringify(policy)],
          );
          return created.id;
        });
        peers.push(peer);
        await advanceModelDeployment(org(), peer, provider);
      }
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const inspect = provider.inspect.bind(provider);
      let active = 0,
        peak = 0,
        calls = 0,
        settled = false;
      provider.inspect = async (key, providerId) => {
        const call = ++calls;
        peak = Math.max(peak, ++active);
        try {
          if (failFirst && call === 1) return null;
          await held;
          return inspect(key, providerId);
        } finally {
          active--;
        }
      };
      const pending = prepareConnectionSave(rotationContext(), provider).finally(() => {
        settled = true;
      });
      const rejected = failFirst
        ? expect(pending).rejects.toMatchObject({ code: 'connection_identity_immutable' })
        : undefined;
      try {
        await vi.waitFor(() => expect(calls).toBe(4));
        expect(settled).toBe(false);
      } finally {
        release();
      }
      if (failFirst) {
        await rejected;
        expect(calls).toBe(4);
        expect(unseal<string>((await resource()).cleanup_secret_ciphertext || '')).toBe(
          'synthetic-compute-secret',
        );
      } else {
        const prepared = await pending;
        await transaction(org(), (tx) => prepared.commit(tx, account.p));
        expect(calls).toBe(9);
        expect(peak).toBe(4);
        const credentials = await transaction(org(), (tx) =>
          tx.query<{ cleanup_secret_ciphertext: string }>(
            'SELECT cleanup_secret_ciphertext FROM model_deployment_resources WHERE connection_id=$1 AND deleted_at IS NULL',
            [computeId],
          ),
        );
        expect(credentials.rows).toHaveLength(9);
        expect(
          credentials.rows.every(
            (value) => unseal<string>(value.cleanup_secret_ciphertext) === 'rotated-same-account',
          ),
        ).toBe(true);
      }
      await transaction(org(), (tx) =>
        tx.query(
          "UPDATE model_deployments SET desired_state='stopped',state='stopped',next_check_at=NULL WHERE id=ANY($1::uuid[])",
          [peers],
        ),
      );
    },
  );

  it('rejects another account key before changing either connection or cleanup authority', async () => {
    await advance();
    await expect(prepareConnectionSave(rotationContext('different-account'), provider)).rejects.toMatchObject(
      { code: 'connection_identity_immutable' },
    );
    expect(unseal<string>((await resource()).cleanup_secret_ciphertext || '')).toBe(
      'synthetic-compute-secret',
    );
    const connection = await transaction(org(), (tx) => resources.get(tx, 'connections', computeId));
    expect(unseal<string>(String(connection.secret_ciphertext))).toBe('synthetic-compute-secret');
  });

  it.each(['MF_REVISION_ID', 'MF_MODEL_CONFIG'])(
    'rejects rotated access to mismatched immutable %s',
    async (field) => {
      await advance();
      const entry = provider.entries.get('endpoint-1');
      if (!entry) throw new Error('Expected the created fixture endpoint.');
      entry.config.env = { ...(entry.config.env as Record<string, string>), [field]: 'changed-recipe' };
      await expect(prepareConnectionSave(rotationContext(), provider)).rejects.toMatchObject({
        code: 'connection_identity_immutable',
      });
    },
  );

  it('blocks key rotation while an accepted create still has an ambiguous provider identity', async () => {
    provider.lostCreate = true;
    await advance();
    await expect(prepareConnectionSave(rotationContext(), provider)).rejects.toMatchObject({
      code: 'deployment_conflict',
    });
    expect(unseal<string>((await resource()).cleanup_secret_ciphertext || '')).toBe(
      'synthetic-compute-secret',
    );
  });

  it.each(['resource', 'connection'])(
    'rejects a concurrent %s change after rotation inspection',
    async (changed) => {
      await advance();
      const prepared = await prepareConnectionSave(rotationContext(), provider);
      await transaction(org(), async (tx) => {
        if (changed === 'resource')
          await tx.query(
            "UPDATE model_deployment_resources SET config=jsonb_set(config,'{env,MF_MODEL_CONFIG}','\"concurrent-recipe\"'::jsonb) WHERE deployment_id=$1",
            [deploymentId],
          );
        else await saveConnection(tx, account.p, { name: 'Concurrent rename' }, computeId);
      });
      await expect(transaction(org(), (tx) => prepared.commit(tx, account.p))).rejects.toMatchObject({
        code: 'deployment_conflict',
      });
      expect(unseal<string>((await resource()).cleanup_secret_ciphertext || '')).toBe(
        'synthetic-compute-secret',
      );
    },
  );

  it('rechecks current connection authority after provider inspection', async () => {
    await advance();
    const prepared = await prepareConnectionSave(rotationContext(), provider);
    await transaction(org(), (tx) =>
      tx.query("UPDATE memberships SET role='viewer' WHERE user_id=$1 AND organization_id=$2", [
        account.p.userId,
        org(),
      ]),
    );
    try {
      await expect(transaction(org(), (tx) => prepared.commit(tx, account.p))).rejects.toMatchObject({
        code: 'permission_denied',
      });
      await expect(prepareConnectionSave(rotationContext(), provider)).rejects.toMatchObject({
        code: 'permission_denied',
      });
      expect(unseal<string>((await resource()).cleanup_secret_ciphertext || '')).toBe(
        'synthetic-compute-secret',
      );
    } finally {
      await transaction(org(), (tx) =>
        tx.query("UPDATE memberships SET role='owner' WHERE user_id=$1 AND organization_id=$2", [
          account.p.userId,
          org(),
        ]),
      );
    }
  });

  it('fences a stale reconciler credential inspection after a newer verified key rotation', async () => {
    await advance();
    await advance();
    await transaction(org(), (tx) =>
      saveConnection(tx, account.p, { secret: 'intermediate-key' }, computeId),
    );
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inspect = provider.inspect.bind(provider);
    provider.inspect = async (key, providerId) => {
      if (key === 'intermediate-key') {
        entered();
        await held;
      }
      return inspect(key, providerId);
    };
    const advancing = advance();
    await ready;
    const prepared = await prepareConnectionSave(rotationContext('newest-key'), provider);
    await transaction(org(), (tx) => prepared.commit(tx, account.p));
    release();
    await advancing;
    expect(unseal<string>((await resource()).cleanup_secret_ciphertext || '')).toBe('newest-key');
    provider.deleteKey = 'newest-key';
    await stopIntent();
    await advance();
    expect((await resource()).deleted_at).not.toBeNull();
  });
});
