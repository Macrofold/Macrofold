import { fixtureConnector } from '../fixtures/operator';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Macrofold, type Schema } from '../../sdk/typescript/src/index';
import { fixtureAccount } from '../fixtures/account';
import { handleApi } from '../../packages/core/src/http';
import { executeRun } from '../../packages/core/src/engine';
import { authPool, pool, transaction } from '../../packages/db';
import { getCustomerBinding } from '../../packages/core/src/customer-agents';
import {
  createCustomerConnection,
  updateCustomerConnectionPermissions,
  presentCustomerConnection,
  deleteCustomerConnection,
} from '../../packages/core/src/customer-agent-connections';
import {
  createCustomerAuthorization,
  describeCustomerConsent,
  startCustomerConsent,
  finishCustomerConsent,
  prepareCustomerCompletion,
} from '../../packages/core/src/customer-connect';
import type { CustomerConnectorProvider } from '../../packages/core/src/customer-connector-provider';
import { config } from '../../packages/core/src/config';
import { composioCustomerConsent } from '../../packages/providers/src/composio-consent';

let account: Awaited<ReturnType<typeof fixtureAccount>>,
  other: Awaited<ReturnType<typeof fixtureAccount>>,
  client: Macrofold;
let alice: Schema['CustomerAgentBinding'], bob: Schema['CustomerAgentBinding'];
const settings: Schema['CustomerAgentEnsure'] = {
  key: 'assistant',
  name: 'Milo',
  configuration: {
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
    limits: { max_cost_micro_usd: '2000000' },
  },
};
const tools: Schema['Tool'][] = [
  { name: 'FIXTURE_READ', description: 'Read fixture records', input_schema: {}, granted: false },
  { name: 'FIXTURE_WRITE', description: 'Write fixture records', input_schema: {}, granted: false },
];
const permissions = [
  { id: 'read', label: 'Read records', tools: ['FIXTURE_READ'] },
  { id: 'write', label: 'Change records', tools: ['FIXTURE_WRITE'] },
];
let starts = 0,
  completes = 0;
const provider: CustomerConnectorProvider = {
  async tools() {
    return tools;
  },
  async start(input) {
    starts++;
    return {
      accountId: input.externalAccountId || 'fixture-account-' + input.connectionId,
      url: 'https://consent.example.test/connect',
    };
  },
  async complete(uri) {
    completes++;
    return { accountId: uri, toolkit: 'fixture' };
  },
};
beforeAll(async () => {
  account = await fixtureAccount('Customer integration path');
  other = await fixtureAccount('Other tenant');
  client = new Macrofold({
    apiKey: account.key,
    baseURL: config.origin,
    retries: 0,
    fetch: (input, init) => handleApi(new Request(input, init)),
  });
  await fixtureConnector('fixture');
  process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED = 'true';
});
afterAll(async () => {
  delete process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED;
  await pool.end();
  await authPool.end();
});
const binding = (customer = 'alice', id = alice.id) =>
  transaction(account.p.organizationId, (tx) => getCustomerBinding(tx, account.p, customer, id));

it('atomically ensures one composition per customer/key under concurrent retries; core resources remain usable', async () => {
  const result = await Promise.all([
    client.customerAgents.ensure('alice', settings),
    client.customerAgents.ensure('alice', settings),
  ]);
  alice = result[0];
  expect(result[1]).toEqual(alice);
  expect(alice.integration_path).toBe('customer-agents');
  expect((await client.workspaces.list()).data).toHaveLength(1);
  expect((await client.agents.get(alice.agent_id)).name).toBe('Milo');
  bob = await client.customerAgents.ensure('bob', settings);
  expect(bob.worktree_id).not.toBe(alice.worktree_id);
  expect((await client.customerAgents.list('alice')).data.map((b) => b.id)).toEqual([alice.id]);
  await expect(client.customerAgents.get('bob', alice.id)).rejects.toMatchObject({ status: 404 });
  await expect(
    transaction(other.p.organizationId, (tx) => getCustomerBinding(tx, other.p, 'alice', alice.id)),
  ).rejects.toMatchObject({ status: 404 });
});

it('runs, continues, streams, and reads files through ownership-checked existing primitives', async () => {
  const key = crypto.randomUUID();
  const first = await client.customerAgents.sendMessage(
    'alice',
    alice.id,
    { prompt: 'Write a short plan' },
    { idempotencyKey: key },
  );
  expect(
    await client.customerAgents.sendMessage(
      'alice',
      alice.id,
      { prompt: 'Write a short plan' },
      { idempotencyKey: key },
    ),
  ).toEqual(first);
  await executeRun(account.p.organizationId, first.run_id);
  expect(await client.customerAgents.waitRun('alice', alice.id, first.run_id)).toMatchObject({
    final: true,
    persistence_status: 'verified',
  });
  const stream = [];
  for await (const event of client.customerAgents.streamRun('alice', alice.id, first.run_id))
    stream.push(event);
  expect(stream.at(-1)?.type).toBe('run.succeeded');
  expect((await client.customerAgents.listConversations('alice', alice.id)).data.map((s) => s.id)).toContain(
    first.session_id,
  );
  const second = await client.customerAgents.sendMessage('alice', alice.id, {
    prompt: 'Continue',
    conversation_id: first.session_id,
  });
  expect(second.session_id).toBe(first.session_id);
  await executeRun(account.p.organizationId, second.run_id);
  const files = await client.customerAgents.listFiles('alice', alice.id);
  const file = files.entries.find((f) => f.type === 'file');
  expect(file).toBeDefined();
  expect(await client.customerAgents.readFile('alice', alice.id, { path: file!.path })).toBeInstanceOf(
    Uint8Array,
  );
  for (const action of [
    () => client.customerAgents.getRun('bob', bob.id, first.run_id),
    () => client.customerAgents.getRunResult('bob', bob.id, first.run_id),
    () => client.customerAgents.listRunEvents('bob', bob.id, first.run_id),
    () => client.customerAgents.cancelRun('bob', bob.id, first.run_id),
    () =>
      client.customerAgents.sendMessage('bob', bob.id, {
        prompt: 'Wrong customer',
        conversation_id: first.session_id,
      }),
    () => client.customerAgents.streamRun('bob', bob.id, first.run_id).next(),
  ])
    await expect(action()).rejects.toMatchObject({ status: 404 });
});

async function setup() {
  const b = await binding();
  const connection = await transaction(account.p.organizationId, (tx) =>
    createCustomerConnection(
      tx,
      account.p,
      b,
      { name: 'My fixture account', provider: 'fixture', capabilities: permissions },
      tools,
    ),
  );
  const authorization = await transaction(account.p.organizationId, (tx) =>
    createCustomerAuthorization(
      tx,
      account.p,
      b,
      connection.connection.id,
      'http://localhost:9876/callback?state=app-owned-nonce',
    ),
  );
  const ticket = new URLSearchParams(new URL(authorization.authorization_url).hash.slice(1)).get('ticket')!;
  return { b, connection, authorization, ticket };
}
async function confirmFlow(context: Awaited<ReturnType<typeof setup>>, selected = ['read']) {
  const response = await startCustomerConsent(context.ticket, selected, provider);
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const redirect = await finishCustomerConsent(
    new Request(
      config.origin +
        '/integrations/composio/callback?session_uri=' +
        encodeURIComponent('fixture-account-' + context.connection.connection.id),
      { headers: { cookie } },
    ),
  );
  const url = new URL(redirect.headers.get('location')!);
  expect(url.searchParams.get('state')).toBe('app-owned-nonce');
  return url.searchParams.get('connection_code')!;
}
it('requires app-authenticated completion; forwarded links cannot attach an account to another customer', async () => {
  const context = await setup();
  expect(await describeCustomerConsent(context.ticket)).toMatchObject({
    selected_capabilities: [],
    return_host: 'localhost:9876',
  });
  const code = await confirmFlow(context);
  expect(
    (
      await transaction(account.p.organizationId, (tx) =>
        presentCustomerConnection(tx, account.p, context.b, context.connection.connection.id),
      )
    ).connection.status,
  ).toBe('pending');
  const before = completes;
  await expect(
    prepareCustomerCompletion(account.p, 'bob', bob.id, context.connection.connection.id, code, provider),
  ).rejects.toMatchObject({ status: 404 });
  expect(completes).toBe(before);
  const prepared = await prepareCustomerCompletion(
    account.p,
    'alice',
    alice.id,
    context.connection.connection.id,
    code,
    provider,
  );
  // A lost commit can reuse the durable verified receipt without redeeming the provider URI twice.
  const resumed = await prepareCustomerCompletion(
    account.p,
    'alice',
    alice.id,
    context.connection.connection.id,
    code,
    provider,
  );
  expect(completes).toBe(before + 1);
  const complete = await transaction(account.p.organizationId, (tx) => resumed.commit(tx, account.p));
  await prepared.dispose();
  expect(complete).toMatchObject({
    approved_tools: ['FIXTURE_READ'],
    selected_capabilities: ['read'],
    connection: { status: 'healthy' },
  });
  await expect(
    prepareCustomerCompletion(account.p, 'alice', alice.id, context.connection.connection.id, code, provider),
  ).rejects.toMatchObject({ status: 409 });
  await expect(startCustomerConsent(context.ticket, ['write'], provider)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    transaction(account.p.organizationId, (tx) =>
      updateCustomerConnectionPermissions(
        tx,
        account.p,
        context.b,
        context.connection.connection.id,
        ['write'],
        '"1"',
        tools,
      ),
    ),
  ).rejects.toMatchObject({ status: 412 });
  const revoked = await transaction(account.p.organizationId, (tx) =>
    updateCustomerConnectionPermissions(
      tx,
      account.p,
      context.b,
      context.connection.connection.id,
      [],
      `"${complete.access_version}"`,
      [],
    ),
  );
  expect(revoked.approved_tools).toEqual([]);
  expect((await client.agents.get(alice.agent_id)).connection_grants).toEqual([]);
  await transaction(account.p.organizationId, (tx) =>
    deleteCustomerConnection(tx, account.p, context.b, context.connection.connection.id),
  );
  expect((await client.customerAgents.listConnections('alice', alice.id)).data).toEqual([]);
});

it('rejects expired links, revoked actors, unknown permissions, and unsafe callback URLs before provider work', async () => {
  const c = await setup(),
    before = starts;
  await expect(startCustomerConsent(c.ticket, ['unknown'], provider)).rejects.toMatchObject({ status: 400 });
  await expect(
    transaction(account.p.organizationId, (tx) =>
      createCustomerAuthorization(
        tx,
        account.p,
        c.b,
        c.connection.connection.id,
        'https://user:pass@example.test/',
      ),
    ),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    transaction(account.p.organizationId, (tx) =>
      createCustomerAuthorization(tx, account.p, c.b, c.connection.connection.id, 'ftp://localhost/callback'),
    ),
  ).rejects.toMatchObject({ status: 400, code: 'invalid_return_url' });
  await transaction(account.p.organizationId, (tx) =>
    tx.query(
      "UPDATE customer_connection_authorizations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [c.authorization.authorization_id],
    ),
  );
  await expect(describeCustomerConsent(c.ticket)).rejects.toMatchObject({ status: 410 });
  expect(starts).toBe(before);
  const fresh = await setup();
  await transaction(account.p.organizationId, (tx) =>
    tx.query("UPDATE memberships SET role='viewer' WHERE user_id=$1", [account.p.userId]),
  );
  await expect(startCustomerConsent(fresh.ticket, ['read'], provider)).rejects.toMatchObject({ status: 403 });
  await transaction(account.p.organizationId, (tx) =>
    tx.query("UPDATE memberships SET role='owner' WHERE user_id=$1", [account.p.userId]),
  );
});

it('wires connection setup, app confirmation and versioned permission changes through the public SDK', async () => {
  const catalog = vi.spyOn(composioCustomerConsent, 'tools').mockImplementation(provider.tools);
  const complete = vi.spyOn(composioCustomerConsent, 'complete').mockImplementation(provider.complete);
  try {
    const connection = await client.customerAgents.createConnection('alice', alice.id, {
      name: 'API fixture account',
      provider: 'fixture',
      capabilities: permissions,
    });
    expect(connection.approved_tools).toEqual([]);
    const authorization = await client.customerAgents.authorizeConnection(
      'alice',
      alice.id,
      connection.connection.id,
      {
        return_url: 'http://localhost:9876/callback?state=app-owned-nonce',
      },
    );
    const ticket = new URLSearchParams(new URL(authorization.authorization_url).hash.slice(1)).get('ticket')!;
    const code = await confirmFlow({ b: await binding(), connection, authorization, ticket });
    const connected = await client.customerAgents.completeConnection(
      'alice',
      alice.id,
      connection.connection.id,
      { code },
    );
    expect(connected.connection.status).toBe('healthy');
    expect(connected.approved_tools).toEqual(['FIXTURE_READ']);
    const revoked = await client.customerAgents.updateConnectionPermissions(
      'alice',
      alice.id,
      connection.connection.id,
      { capability_ids: [], ifMatch: `"${connected.access_version}"` },
    );
    expect(revoked.approved_tools).toEqual([]);
    await expect(
      client.customerAgents.updateConnectionPermissions('alice', alice.id, connection.connection.id, {
        capability_ids: ['write'],
        ifMatch: `"${connected.access_version}"`,
      }),
    ).rejects.toMatchObject({ status: 412 });
    await client.customerAgents.deleteConnection('alice', alice.id, connection.connection.id);
    expect(
      (await client.customerAgents.listConnections('alice', alice.id)).data.some(
        (c) => c.connection.id === connection.connection.id,
      ),
    ).toBe(false);
  } finally {
    catalog.mockRestore();
    complete.mockRestore();
  }
});

it('fences stale consent against permission revocation and preserves the account on reconnect', async () => {
  const c = await setup(),
    code = await confirmFlow(c);
  const receipt = await prepareCustomerCompletion(
    account.p,
    'alice',
    alice.id,
    c.connection.connection.id,
    code,
    provider,
  );
  await transaction(account.p.organizationId, (tx) =>
    updateCustomerConnectionPermissions(
      tx,
      account.p,
      c.b,
      c.connection.connection.id,
      [],
      `"${c.connection.access_version}"`,
      [],
    ),
  );
  await expect(
    transaction(account.p.organizationId, (tx) => receipt.commit(tx, account.p)),
  ).rejects.toMatchObject({ status: 412 });
  expect(
    (
      await transaction(account.p.organizationId, (tx) =>
        presentCustomerConnection(tx, account.p, c.b, c.connection.connection.id),
      )
    ).approved_tools,
  ).toEqual([]);
  const next = await transaction(account.p.organizationId, (tx) =>
    createCustomerAuthorization(
      tx,
      account.p,
      c.b,
      c.connection.connection.id,
      'http://localhost:9876/callback',
    ),
  );
  const ticket = new URLSearchParams(new URL(next.authorization_url).hash.slice(1)).get('ticket')!;
  const response = await startCustomerConsent(ticket, ['read'], {
    ...provider,
    async start(input) {
      expect(input.externalAccountId).toBe('fixture-account-' + c.connection.connection.id);
      return provider.start(input);
    },
  });
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie()).toHaveLength(2);
  expect(response.headers.getSetCookie()[1]).toContain('composio-state=;');
  expect(response.headers.getSetCookie()[1]).toContain('Max-Age=0');
});

it('does not repeat an ambiguous account creation, including a replacement-link attempt during dispatch', async () => {
  const c = await setup();
  const uncertain: CustomerConnectorProvider = {
    ...provider,
    async start() {
      await expect(
        transaction(account.p.organizationId, (tx) =>
          createCustomerAuthorization(
            tx,
            account.p,
            c.b,
            c.connection.connection.id,
            'http://localhost:9876/callback',
          ),
        ),
      ).rejects.toMatchObject({ status: 409, code: 'connection_recovery_required' });
      throw new Error('Provider response lost');
    },
  };
  await expect(startCustomerConsent(c.ticket, ['read'], uncertain)).rejects.toThrow('Provider response lost');
  await expect(startCustomerConsent(c.ticket, ['read'], provider)).rejects.toMatchObject({ status: 409 });
  await expect(
    transaction(account.p.organizationId, (tx) =>
      createCustomerAuthorization(
        tx,
        account.p,
        c.b,
        c.connection.connection.id,
        'http://localhost:9876/callback',
      ),
    ),
  ).rejects.toMatchObject({ status: 409 });
});
