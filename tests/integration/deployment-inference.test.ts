import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { authPool, pool, transaction, lock } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { id, seal } from '../../packages/core/src/crypto';
import { createKey } from '../../packages/core/src/keys';
import * as resources from '../../packages/core/src/resources';
import { handleApi } from '../../packages/core/src/http';
import type { Principal } from '../../packages/core/src/auth';
import type { InferenceCreate } from '../../packages/core/src/decision';
import { prepareInference } from '../../packages/core/src/inferences';
import { getRun } from '../../packages/core/src/runs';
import { runTraceContext } from '../../packages/core/src/run-tracing';
import * as tracing from '../../packages/core/src/tracing';
import type { ModelDeploymentCapabilities } from '../../packages/core/src/model-deployment-types';

const caps: ModelDeploymentCapabilities = {
  protocol: 'openai_chat',
  input_modalities: ['text'],
  chat_completions: true,
  json_object: true,
  json_schema: true,
  tools: true,
  streaming: true,
  stream_usage: true,
  schema_keywords: ['type', 'properties', 'required', 'additionalProperties'],
  accepted_parameters: ['temperature', 'n'],
  schema_dialect: null,
  context_window_tokens: 4096,
  max_output_tokens: 512,
  max_concurrent_requests: 2,
};
const systemOneCaps: ModelDeploymentCapabilities = {
  ...caps,
  protocol: 'systemone',
  chat_completions: false,
  json_object: false,
  json_schema: false,
  tools: false,
  streaming: false,
  stream_usage: false,
  schema_keywords: [],
  accepted_parameters: [],
};
const decisionInput = {
  state: { type: 'image', description: 'An ordinary record, not a chat attachment.' },
  questions: {
    may_continue: { type: 'noul', instructions: 'Can this task continue?' },
    next_action: {
      type: 'choice',
      instructions: 'Choose the next action.',
      criteria: { wait: 'Wait for review', proceed: 'Proceed now' },
    },
    urgency: { type: 'score', instructions: 'How urgent is it?', criteria: ['Low', 'High'] },
  },
};
const decisionResponse = {
  model: 'kev-latest',
  answers: {
    may_continue: { type: 'noul', noul: 0.75 },
    next_action: { type: 'choice', choice: 'wait', probabilities: { wait: 0.8, proceed: 0.2 } },
    urgency: { type: 'score', score: 0.4, probabilities: { '0': 0.6, '1': 0.4 } },
  },
  usage: { input_tokens: 42, output_tokens: 0 },
  latency_ms: 12,
  truncated: false,
  provider_native_extra: { preserved: true },
};
let owner: Principal, key: string, keyId: string, workspace: string, origin: string;
const initialPaid = config.allowPaid;
const server = createServer(async (request, response) => {
  calls++;
  expect(request.url).toBe(systemOne ? '/v1/systemone' : '/v1/chat/completions');
  expect(request.headers.authorization).toBe('Bearer fixture-endpoint-secret');
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
  if (systemOne) expect(body).toEqual({ ...decisionInput, model: 'kev-latest' });
  else
    expect(body).toMatchObject({
      model: 'fixture-model',
      messages: [{ role: 'user', content: 'Synthetic hello' }],
    });
  expect(body).not.toHaveProperty('provider');
  if (hold) {
    held = response;
    entered?.();
  } else finish(response);
});
let calls = 0,
  systemOne = false,
  hold = false,
  held: ServerResponse | undefined,
  entered: (() => void) | undefined;
function finish(response: ServerResponse) {
  if (systemOne) {
    response.writeHead(200, {
      'content-type': 'application/json',
      'x-typesafe-request-id': 'fixture-kev-request',
    });
    response.end(JSON.stringify(decisionResponse));
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(
    JSON.stringify({
      id: 'fixture-completion',
      model: 'fixture-model',
      provider_native_extra: 'preserved',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'Synthetic answer' }, finish_reason: 'stop' },
      ],
    }),
  );
}
beforeAll(async () => {
  const account = await fixtureAccount('Deployment inference');
  owner = account.p;
  const address = server.listen(0, '127.0.0.1').address();
  if (!address) await once(server, 'listening');
  const bound = server.address();
  if (!bound || typeof bound === 'string') throw new Error('Fixture server did not bind');
  origin = `http://127.0.0.1:${bound.port}`;
  await transaction(owner.organizationId, async (tx) => {
    workspace = (
      await resources.create(tx, 'workspaces', owner.organizationId, { name: 'Deployment fixture' })
    ).id;
    const issued = await createKey(tx, owner, {
      name: 'Deployment application',
      workspace_id: workspace,
      scopes: ['runs:write', 'runs:read', 'model-deployments:read', 'model-deployments:use'],
    });
    key = issued.secret;
    keyId = issued.id;
  });
});
afterEach(async () => {
  if (held && !held.writableEnded) finish(held);
  held = undefined;
  entered = undefined;
  hold = false;
  systemOne = false;
  calls = 0;
  if (owner) await retireFixtureRuns(owner.organizationId);
  config.allowPaid = initialPaid;
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await Promise.all([pool.end(), authPool.end()]);
});
async function deployment(capabilities = caps) {
  config.allowPaid = true;
  vi.stubEnv('LOCAL_MODEL_ENDPOINT_ALLOWED_ORIGINS', origin);
  const deploymentId = id(),
    revisionId = id();
  let connectionId = '';
  await transaction(owner.organizationId, async (tx) => {
    const connection = await resources.create(tx, 'connections', owner.organizationId, {
      name: 'Fixture endpoint',
      kind: 'external_model',
      url: origin + '/v1',
      auth_method: 'bearer',
      owner_subject_id: owner.userId,
      status: 'healthy',
      secret_ciphertext: seal('fixture-endpoint-secret'),
    });
    connectionId = connection.id;
    await tx.query(
      "INSERT INTO model_deployments(id,organization_id,owner_subject_id,name,desired_state,state,policy) VALUES($1,$2,$3,$4,'running','ready',$5)",
      [
        deploymentId,
        owner.organizationId,
        owner.userId,
        'Fixture model',
        JSON.stringify({ max_concurrent_requests: 1 }),
      ],
    );
    await tx.query(
      'INSERT INTO model_deployment_revisions(id,organization_id,deployment_id,source,runtime,hosting,capabilities,source_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        revisionId,
        owner.organizationId,
        deploymentId,
        JSON.stringify({ kind: 'external', repository: null, revision: null, capabilities }),
        JSON.stringify({ kind: 'external', engine: null, version: null }),
        JSON.stringify({
          kind: capabilities.protocol === 'systemone' ? 'external_systemone' : 'external_openai',
          endpoint_connection_id: connection.id,
          model_alias: capabilities.protocol === 'systemone' ? 'kev-latest' : 'fixture-model',
          lifecycle: 'external',
        }),
        JSON.stringify(capabilities),
        JSON.stringify({ endpoint_url: origin + '/v1' }),
      ],
    );
    await tx.query('UPDATE model_deployments SET desired_revision_id=$2,serving_revision_id=$2 WHERE id=$1', [
      deploymentId,
      revisionId,
    ]);
    await tx.query(
      'INSERT INTO model_deployment_connections(organization_id,deployment_id,revision_id,connection_id,approved_by) VALUES($1,$2,$3,$4,$5)',
      [owner.organizationId, deploymentId, revisionId, connection.id, owner.userId],
    );
    await tx.query(
      "INSERT INTO model_deployment_grants(id,organization_id,deployment_id,subject_kind,subject_id,workspace_ids,approved_by) VALUES($1,$2,$3,'api_key',$4,$5,$6)",
      [id(), owner.organizationId, deploymentId, keyId, [workspace], owner.userId],
    );
  });
  return { deploymentId, revisionId, connectionId };
}
function body(deploymentId: string): InferenceCreate {
  return {
    workspace_id: workspace,
    model_binding: { deployment_id: deploymentId },
    input: { messages: [{ role: 'user', content: 'Synthetic hello' }] },
    limits: { max_cost_micro_usd: '0', max_output_tokens: 128, timeout_seconds: 10 },
  };
}
function api(input: unknown, identity = id(), background?: Parameters<typeof handleApi>[2]) {
  return handleApi(
    new Request(`${config.origin}/v1/inferences`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'idempotency-key': identity,
      },
      body: JSON.stringify(input),
    }),
    'rest',
    background,
  );
}

it('orders stateless deployment admission behind organization control without locking the deployment first', async () => {
  const { deploymentId } = await deployment();
  const scopes = ['runs:write', 'runs:read', 'model-deployments:read', 'model-deployments:use'];
  const issued = await transaction(owner.organizationId, async (tx) => {
    const application = await createKey(tx, owner, { name: 'Stateless application', scopes });
    await tx.query(
      "INSERT INTO model_deployment_grants(id,organization_id,deployment_id,subject_kind,subject_id,approved_by) VALUES($1,$2,$3,'api_key',$4,$5)",
      [id(), owner.organizationId, deploymentId, application.id, owner.userId],
    );
    return application;
  });
  const principal: Principal = { ...owner, id: issued.id, kind: 'api_key', scopes, workspaceIds: [] };
  const prepared = await prepareInference(
    principal,
    { ...body(deploymentId), workspace_id: undefined },
    'inference',
    true,
  );
  let admission: Promise<unknown> | undefined;
  try {
    await transaction(owner.organizationId, async (tx) => {
      await lock(tx, `organization:${owner.organizationId}`);
      const { pid } = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0];
      admission = transaction(owner.organizationId, (next) => prepared.commit(next, principal));
      await expect
        .poll(async () => {
          const waiting = await pool.query<{ count: number }>(
            "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%pg_advisory_xact_lock%'",
            [pid],
          );
          return waiting.rows[0].count;
        })
        .toBeGreaterThan(0);
      // A workspace-bound admission or organization control owns this order.
      // Taking the deployment first on the stateless path creates a lock cycle.
      await tx.query('SELECT id FROM model_deployments WHERE id=$1 FOR UPDATE NOWAIT', [deploymentId]);
    });
    expect(await admission).toMatchObject({ status: 'running' });
    expect(calls).toBe(0);
  } finally {
    await admission?.catch(() => {});
    await prepared.dispose();
  }
});

it('rejects mixed deployment bindings with the canonical error before admitting or dispatching', async () => {
  const { deploymentId } = await deployment();
  const invalid = await api({
    ...body(deploymentId),
    model_binding: {
      deployment_id: deploymentId,
      provider: 'openrouter',
      model: 'fixture-model',
      billing_mode: 'byok',
    },
  });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ error: { code: 'invalid_deployment_binding' } });
  expect(calls).toBe(0);
  const count = await transaction(owner.organizationId, (tx) =>
    tx.query("SELECT count(*) FROM runs WHERE config#>>'{deployment_target,deployment_id}'=$1", [
      deploymentId,
    ]),
  );
  expect(count.rows[0].count).toBe('0');
});

it.each([null, { messages: [{ role: 'user', content: 'Synthetic hello' }], response_format: [] }])(
  'rejects malformed native request objects as nonretryable client errors before admission: %j',
  async (input) => {
    const { deploymentId } = await deployment();
    const rejected = await api({ ...body(deploymentId), input });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      error: { code: 'invalid_request', retryable: false },
    });
    expect(calls).toBe(0);
    const runs = await transaction(owner.organizationId, (tx) =>
      tx.query("SELECT id FROM runs WHERE config#>>'{deployment_target,deployment_id}'=$1", [deploymentId]),
    );
    expect(runs.rows).toEqual([]);
  },
);

it('rechecks delegated credentials after waiting for shared inference capacity', async () => {
  const { deploymentId, connectionId } = await deployment();
  const principal: Principal = {
    ...owner,
    id: keyId,
    kind: 'api_key',
    scopes: ['runs:write', 'runs:read', 'model-deployments:read', 'model-deployments:use'],
    workspaceIds: [workspace],
  };
  const prepared = await prepareInference(principal, body(deploymentId), 'inference', true);
  let admission: Promise<unknown> | undefined;
  try {
    await transaction(owner.organizationId, async (tx) => {
      await lock(tx, 'capacity:global');
      const { pid } = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0];
      admission = transaction(owner.organizationId, (next) => prepared.commit(next, principal));
      await expect
        .poll(async () => {
          const waiting = await pool.query<{ count: number }>(
            "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%pg_advisory_xact_lock%'",
            [pid],
          );
          return waiting.rows[0].count;
        })
        .toBeGreaterThan(0);
      await transaction(owner.organizationId, (edit) =>
        resources.update(edit, 'connections', connectionId, { status: 'expired' }),
      );
    });
    await expect(admission).rejects.toMatchObject({ code: 'permission_denied' });
    const runs = await transaction(owner.organizationId, (tx) =>
      tx.query("SELECT id FROM runs WHERE config#>>'{deployment_target,deployment_id}'=$1", [deploymentId]),
    );
    expect(runs.rows).toEqual([]);
    expect(calls).toBe(0);
  } finally {
    await admission?.catch(() => {});
    await prepared.dispose();
  }
});

it('returns a native answer and original revision on replay after stop without charging hosting per request', async () => {
  const { deploymentId, revisionId } = await deployment();
  const identity = id();
  const request = body(deploymentId);
  const first = await api(request, identity);
  expect(first.status).toBe(200);
  const saved = await first.json();
  expect(saved).toMatchObject({
    status: 'succeeded',
    result: {
      inference: {
        outcome: 'value',
        deployment: { deployment_id: deploymentId, deployment_revision_id: revisionId },
        cost_attribution: {
          basis: 'deployment',
          deployment_id: deploymentId,
          infrastructure_cost_included: false,
        },
        value: {
          provider_native_extra: 'preserved',
          choices: [{ message: { content: 'Synthetic answer' } }],
        },
        usage: { input_tokens: null, output_tokens: null, completeness: 'missing' },
        billing: {
          billing_mode: 'byok',
          charged_micro_usd: '0',
          budget_cost_micro_usd: '0',
          reported_micro_usd: '0',
          reserved_micro_usd: '0',
          provider_cost_micro_usd: null,
          provider_cost_status: 'unavailable',
        },
      },
    },
  });
  await transaction(owner.organizationId, (tx) =>
    tx.query(
      "UPDATE model_deployments SET desired_state='stopped',state='stopped',serving_revision_id=NULL WHERE id=$1",
      [deploymentId],
    ),
  );
  const replay = await api(request, identity);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(saved);
  const refused = await api(request);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: { code: 'deployment_not_ready' } });
  expect(calls).toBe(1);
});

it('preserves native SystemOne questions, answers and metering and replays without another model call', async () => {
  systemOne = true;
  const { deploymentId, revisionId } = await deployment(systemOneCaps);
  const request = { ...body(deploymentId), input: decisionInput };
  const identity = id();
  const first = await api(request, identity);
  expect(first.status).toBe(200);
  const receipt = await first.json();
  expect(receipt).toMatchObject({
    status: 'succeeded',
    result: {
      inference: {
        outcome: 'value',
        deployment: { deployment_id: deploymentId, deployment_revision_id: revisionId },
        provider_request_id: 'fixture-kev-request',
        usage: { input_tokens: '42', output_tokens: '0', completeness: 'complete' },
        billing: {
          billing_mode: 'byok',
          charged_micro_usd: '0',
          budget_cost_micro_usd: '0',
          reported_micro_usd: '0',
          reserved_micro_usd: '0',
          provider_cost_micro_usd: null,
          provider_cost_status: 'unavailable',
        },
      },
    },
  });
  expect(receipt.result.inference.value).toEqual(decisionResponse);
  const enabled = vi.spyOn(tracing, 'tracingEnabled').mockReturnValue(true);
  try {
    const context = await transaction(owner.organizationId, async (tx) =>
      runTraceContext(tx, await getRun(tx, receipt.run_id, owner)),
    );
    expect(context).toMatchObject({
      deployment_id: deploymentId,
      deployment_revision_id: revisionId,
      inference_protocol: 'systemone',
      billing_mode: 'byok',
    });
  } finally {
    enabled.mockRestore();
  }
  const usage = await transaction(owner.organizationId, (tx) =>
    tx.query(
      'SELECT input_tokens,output_tokens,cost_micro_usd,completeness FROM model_usage WHERE run_id=$1',
      [receipt.run_id],
    ),
  );
  expect(usage.rows).toEqual([
    { input_tokens: '42', output_tokens: '0', cost_micro_usd: '0', completeness: 'complete' },
  ]);
  const replay = await api(request, identity);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(receipt);
  expect(calls).toBe(1);
});

it('rejects SystemOne streaming before admitting a Run or calling the endpoint', async () => {
  systemOne = true;
  const { deploymentId } = await deployment(systemOneCaps);
  const background: (() => Promise<void>)[] = [];
  const response = await api({ ...body(deploymentId), input: decisionInput, stream: true }, id(), (task) =>
    background.push(task),
  );
  await Promise.all(background.map((task) => task()));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: { code: 'unsupported_model_capability' } });
  const runs = await transaction(owner.organizationId, (tx) =>
    tx.query("SELECT id FROM runs WHERE config#>>'{deployment_target,deployment_id}'=$1", [deploymentId]),
  );
  expect(runs.rows).toEqual([]);
  expect(calls).toBe(0);
});

it('rejects capacity before creating another Run and preserves an accepted result across stop intent', async () => {
  const { deploymentId, revisionId } = await deployment();
  hold = true;
  const providerEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = api(body(deploymentId));
  await providerEntered;
  const capacity = await api(body(deploymentId));
  expect(capacity.status).toBe(429);
  expect(await capacity.json()).toMatchObject({ error: { code: 'deployment_capacity' } });
  await transaction(owner.organizationId, (tx) =>
    tx.query("UPDATE model_deployments SET desired_state='stopped',state='stopping' WHERE id=$1", [
      deploymentId,
    ]),
  );
  if (!held) throw new Error('Missing held provider response');
  finish(held);
  const completed = await pending;
  expect(completed.status).toBe(200);
  expect(await completed.json()).toMatchObject({
    status: 'succeeded',
    result: { inference: { outcome: 'value', deployment: { deployment_revision_id: revisionId } } },
  });
  expect(calls).toBe(1);
  const count = await transaction(owner.organizationId, (tx) =>
    tx.query("SELECT count(*) FROM runs WHERE config#>>'{deployment_target,deployment_id}'=$1", [
      deploymentId,
    ]),
  );
  expect(count.rows[0].count).toBe('1');
});

it.each(['openai_chat', 'systemone'] as const)(
  'denies %s grant revocation at publication without erasing incurred usage identity',
  async (protocol) => {
    systemOne = protocol === 'systemone';
    const { deploymentId } = await deployment(systemOne ? systemOneCaps : caps);
    hold = true;
    const providerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = api({ ...body(deploymentId), ...(systemOne ? { input: decisionInput } : {}) });
    await providerEntered;
    await transaction(owner.organizationId, (tx) =>
      tx.query('UPDATE model_deployment_grants SET revoked_at=clock_timestamp() WHERE deployment_id=$1', [
        deploymentId,
      ]),
    );
    if (!held) throw new Error('Missing held provider response');
    finish(held);
    const completed = await pending;
    expect(completed.status).toBe(200);
    const receipt = await completed.json();
    expect(receipt).toMatchObject({
      status: 'failed',
      result: {
        inference: {
          reason_code: 'authorization_revoked',
          billing: { charged_micro_usd: '0' },
          usage_request_id: expect.any(String),
        },
      },
    });
    expect(receipt.result.inference).not.toHaveProperty('value');
    expect(calls).toBe(1);
  },
);

it.each(['rotation', 'disconnect'] as const)(
  'preserves current credential authority for an accepted response: %s',
  async (change) => {
    const { deploymentId, connectionId } = await deployment();
    hold = true;
    const providerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = api(body(deploymentId));
    await providerEntered;
    await transaction(owner.organizationId, (tx) =>
      resources.update(
        tx,
        'connections',
        connectionId,
        change === 'rotation' ? { secret_ciphertext: seal('rotated-fixture-secret') } : { status: 'expired' },
      ),
    );
    if (!held) throw new Error('Missing held provider response');
    finish(held);
    const completed = await pending;
    expect(completed.status).toBe(200);
    const result = await completed.json();
    expect(result.result.inference.billing.charged_micro_usd).toBe('0');
    if (change === 'rotation')
      expect(result.result.inference).toMatchObject({
        outcome: 'value',
        value: { provider_native_extra: 'preserved' },
      });
    else {
      expect(result.result.inference).toMatchObject({
        outcome: 'failed',
        reason_code: 'authorization_revoked',
      });
      expect(result.result.inference).not.toHaveProperty('value');
    }
    expect(calls).toBe(1);
  },
);
