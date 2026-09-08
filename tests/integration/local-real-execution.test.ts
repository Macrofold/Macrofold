import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { config } from '../../packages/core/src/config';
import { authPool, credentialPool, pool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import { credit } from '../../packages/core/src/ledger';
import { createKey } from '../../packages/core/src/keys';
import { handleApi } from '../../packages/core/src/http';
import { handleModelRequest } from '../../packages/core/src/model-gateway';
import { runtimeToken } from '../../packages/core/src/runtime-auth';
import { getRun } from '../../packages/core/src/runs';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import { claimRun } from '../../packages/core/src/engine';
import { FaultMachine } from '../fixtures/cloud-machine';
import * as resources from '../../packages/core/src/resources';
import { Client } from '../../sdk/typescript/src/index';
const original = { ...config };
let principal: Principal;
let client: Client;
let secret: string;
beforeAll(async () => {
  const user = (
    await auth.api.signUpEmail({
      body: {
        email: `docker-${id()}@example.test`,
        name: 'Local native fixture',
        password: 'local-native-fixture-password',
      },
    })
  ).user;
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  const org = (await pool.query('SELECT organization_id FROM memberships WHERE user_id=$1', [user.id]))
    .rows[0].organization_id;
  principal = {
    id: user.id,
    userId: user.id,
    organizationId: org,
    kind: 'user',
    role: 'owner',
    scopes: customerScopes,
    projectIds: [],
    operator: false,
  };
  secret = await transaction(org, async (tx) => {
    await credit(tx, org, 25_000_000n, `fixture:${id()}`);
    return (await createKey(tx, principal, { name: 'API fixture', scopes: customerScopes })).secret;
  });
  client = new Client({
    baseURL: config.origin,
    token: secret,
    retries: 0,
    fetch: async (url, init) => handleApi(new Request(url, init)),
  });
});
afterEach(() => {
  Object.assign(config, original);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});
function docker() {
  Object.assign(config, { execution: 'docker', orchestration: 'poller', allowPaid: true });
  vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '0');
  vi.stubEnv('OPENAI_API_KEY', 'managed-fixture');
  vi.stubEnv(
    'MODEL_CATALOG_JSON',
    JSON.stringify([
      {
        id: 'native-fixture',
        name: 'Native fixture',
        provider: 'openai',
        harnesses: ['codex'],
        enabled: true,
        input_micro_usd_per_million: '1000000',
        output_micro_usd_per_million: '2000000',
      },
    ]),
  );
}
async function submit(connectionId?: string) {
  const project = await client.request('createProject', { body: { name: 'Native API fixture' } });
  return client.request('createRun', {
    body: {
      project_id: project.id,
      harness: 'codex',
      model: 'native-fixture',
      prompt: 'Fixture',
      billing_mode: connectionId ? 'byok' : 'managed',
      ...(connectionId ? { provider_connection_id: connectionId } : {}),
      limits: { timeout_seconds: 60, max_cost_micro_usd: '2000000' },
    },
  });
}
it('requires opt-in before real local admission and rejects incompatible models without holding funds', async () => {
  docker();
  config.allowPaid = false;
  await expect(submit()).rejects.toMatchObject({ code: 'execution_disabled' });
  config.allowPaid = true;
  const project = await client.request('createProject', { body: { name: 'Rejected model' } });
  await expect(
    client.request('createRun', {
      body: {
        project_id: project.id,
        harness: 'claude-code',
        model: 'native-fixture',
        billing_mode: 'managed',
        prompt: 'Denied',
      },
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect((await client.request('getBilling')).reserved_micro_usd).toBe('0');
  const anonymous = await handleApi(new Request(`${config.origin}/v1/runs`));
  expect(anonymous.status).toBe(401);
});
it('keeps a leftover simulator from claiming or executing native work', async () => {
  docker();
  const accepted = await submit();
  config.execution = 'simulator';
  expect(await claimRun(principal.organizationId, accepted.run_id)).toBeNull();
  const machine = new FaultMachine();
  expect(await advanceCloudRun(principal.organizationId, accepted.run_id, machine)).toMatchObject({
    queued: true,
  });
  expect(machine.starts).toBe(0);
  expect((await client.request('getRun', { params: { path: { run_id: accepted.run_id } } })).status).toBe(
    'queued',
  );
  expect((await client.request('getBilling')).reserved_micro_usd).toBe('2000000');
  await client.request('cancelRun', { params: { path: { run_id: accepted.run_id } } });
  expect((await client.request('getBilling')).reserved_micro_usd).toBe('0');
});
it.each(['managed', 'byok'] as const)(
  'keeps %s accounting and runtime authority through real local admission, gateway, cancellation and publication',
  async (billing) => {
    docker();
    const connection =
      billing === 'byok'
        ? await client.request('createConnection', {
            body: {
              kind: 'model',
              provider: 'openai',
              name: 'Customer fixture',
              auth_method: 'api_key',
              secret: 'customer-fixture',
            },
          })
        : undefined;
    const accepted = await submit(connection?.id);
    expect((await client.request('getBilling')).reserved_micro_usd).toBe('2000000');
    const machine = new FaultMachine();
    machine.lostLaunch = true;
    for (let step = 0; step < 15; step++) {
      await advanceCloudRun(principal.organizationId, accepted.run_id, machine);
      if (
        (await transaction(principal.organizationId, (tx) => getRun(tx, accepted.run_id))).execution_binding
          ?.phase === 'poll'
      )
        break;
    }
    const run = await transaction(principal.organizationId, (tx) => getRun(tx, accepted.run_id));
    const token = runtimeToken({
      organization: principal.organizationId,
      run: run.id,
      lease: run.lease_generation,
      expires: Date.now() + 60_000,
    });
    const request = (capability = token) =>
      new Request(`${config.origin}/runtime/runs/${run.id}/model/v1/responses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${capability}` },
        body: JSON.stringify({ model: 'native-fixture', input: 'small fixture', max_output_tokens: 10 }),
      });
    const upstream = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe(
        `Bearer ${billing === 'byok' ? 'customer-fixture' : 'managed-fixture'}`,
      );
      return Response.json({ usage: { input_tokens: 100, output_tokens: 10 }, output: [] });
    });
    expect((await handleModelRequest(request('wrong'), run.id, 'v1/responses', upstream)).status).toBe(401);
    const expired = runtimeToken({
      organization: principal.organizationId,
      run: run.id,
      lease: run.lease_generation,
      expires: Date.now() - 1,
    });
    expect((await handleModelRequest(request(expired), run.id, 'v1/responses', upstream)).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    expect((await handleModelRequest(request(), run.id, 'v1/responses', upstream)).status).toBe(200);
    if (connection) {
      await transaction(principal.organizationId, (tx) =>
        resources.update(tx, 'connections', connection.id, { status: 'error' }),
      );
      expect((await handleModelRequest(request(), run.id, 'v1/responses', upstream)).status).toBe(403);
    }
    await client.request('cancelRun', { params: { path: { run_id: run.id } } });
    expect((await handleModelRequest(request(), run.id, 'v1/responses', upstream)).status).toBe(409);
    expect(upstream).toHaveBeenCalledTimes(1);
    for (let step = 0; step < 60; step++)
      if ((await advanceCloudRun(principal.organizationId, run.id, machine)).done) break;
    const result = await client.request('getRun', { params: { path: { run_id: run.id } } });
    expect(result.status).toBe('cancelled');
    expect(result.persistence_status).toBe('verified');
    expect(result.cost_micro_usd).toBe(billing === 'byok' ? '0' : '120');
    expect((await client.request('getBilling')).reserved_micro_usd).toBe('0');
    expect(machine.starts).toBe(1);
    const saved = await transaction(principal.organizationId, (tx) =>
      tx.query('SELECT model_reserved_micro_usd,budget_used_micro_usd FROM runs WHERE id=$1', [run.id]),
    );
    expect(saved.rows[0]).toEqual({ model_reserved_micro_usd: '0', budget_used_micro_usd: '120' });
  },
);
