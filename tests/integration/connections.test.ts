import { fixtureConnector, fixtureOperator } from '../fixtures/operator';
import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { startComposio, finishComposio } from '../../packages/core/src/composio-auth';
import { patchAccess } from '../../packages/core/src/connection-access';
import * as connections from '../../packages/core/src/connections';
import * as resources from '../../packages/core/src/resources';
import { disconnectConnection, cleanConnection } from '../../packages/core/src/connection-cleanup';
let a: Awaited<ReturnType<typeof fixtureAccount>>, b: Awaited<ReturnType<typeof fixtureAccount>>;
const oldEnv = { ...process.env };
// Next.js wraps route requests in a proxy; native Request cloning cannot read its private state.
const browserRequest = (url: string, init: RequestInit) =>
  new Proxy(new Request(url, init), {
    get: (target, key) => Reflect.get(target, key, target),
  });
beforeAll(async () => {
  await fixtureConnector();
  a = await fixtureAccount('Connector owner');
  b = await fixtureAccount('Other connector user');
  process.env.COMPOSIO_API_KEY = 'fixture-no-real-account';
  process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED = 'true';
  vi.spyOn(connections, 'composio').mockReturnValue({
    connectedAccounts: {
      link: async (user: string, _config: string, options: { alias: string; allowMultiple: boolean }) => {
        expect(user).toBe(`${a.p.organizationId}:${a.p.userId}`);
        expect(options).toMatchObject({
          allowMultiple: true,
          alias: expect.stringMatching(/^[a-f0-9-]{36}$/),
        });
        return { id: 'fixture-connected', redirectUrl: 'https://connect.composio.dev/fixture' };
      },
      refresh: async (id: string) => ({
        id,
        redirect_url: 'https://connect.composio.dev/reconnect',
        status: 'INITIATED',
      }),
      get: async (id: string) => ({ id, toolkit: { slug: 'gmail' }, status: 'ACTIVE', isDisabled: false }),
    },
  } as unknown as ReturnType<typeof connections.composio>);
});
afterAll(async () => {
  await fixtureOperator((db) => db.query("DELETE FROM connector_enablement WHERE toolkit='gmail'"));
  vi.restoreAllMocks();
  for (const key of [
    'COMPOSIO_API_KEY',
    'COMPOSIO_CALLBACK_VERIFICATION_ENABLED',
  ]) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
  await pool.end();
  await authPool.end();
});
it('serializes simultaneous grant updates so a stale edit cannot overwrite a revocation', async () => {
  const connection = await transaction(a.p.organizationId, (tx) =>
    connections.saveConnection(tx, a.p, {
      name: 'Grant concurrency fixture',
      kind: 'search',
      provider: 'brave',
      auth_method: 'none',
    }),
  );
  const outcomes = await Promise.allSettled([
    transaction(a.p.organizationId, (tx) => patchAccess(tx, a.p, connection.id, { tools: [] }, '"1"')),
    transaction(a.p.organizationId, (tx) =>
      patchAccess(tx, a.p, connection.id, { tools: ['web_search'] }, '"1"'),
    ),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
    reason: { code: 'stale_revision' },
  });
  const stored = await transaction(a.p.organizationId, (tx) =>
    resources.get(tx, 'connections', connection.id),
  );
  expect(stored.access_version).toBe('2');
  expect(stored.access_tools).toEqual(
    outcomes.find((outcome) => outcome.status === 'fulfilled')?.value.tools,
  );
  await transaction(a.p.organizationId, (tx) =>
    resources.update(tx, 'connections', connection.id, { deleted: true }),
  );
});
it('requires matching browser identity and Composio account binding before activating an app', async () => {
  const c = await transaction(a.p.organizationId, (tx) =>
    connections.saveConnection(tx, a.p, {
      name: 'Email fixture',
      kind: 'composio',
      provider: 'gmail',
      auth_method: 'oauth',
    }),
  );
  const start = await startComposio(
    browserRequest(
      `${config.origin}/integrations/composio/install?connection_id=${c.id}&organization_id=${a.p.organizationId}`,
      { headers: { cookie: a.cookie } },
    ),
  );
  expect(start.status).toBe(302);
  const state = start.headers.get('set-cookie')!.split(';')[0];
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++;
    expect(String(url)).toBe('https://backend.composio.dev/api/v3.1/connected_accounts/complete_auth');
    expect(JSON.parse(String(init?.body))).toEqual({
      session_uri: 'opaque-uri-not-a-fetch-target',
      user_id: `${a.p.organizationId}:${a.p.userId}`,
    });
    return Response.json({ connected_account_id: 'fixture-connected', toolkit_slug: 'gmail' });
  };
  const callback =
    config.origin + '/integrations/composio/callback?session_uri=opaque-uri-not-a-fetch-target';
  await expect(
    finishComposio(browserRequest(callback, { headers: { cookie: b.cookie + '; ' + state } }), transport),
  ).rejects.toBeTruthy();
  expect(calls).toBe(0);
  expect(
    (
      await finishComposio(
        browserRequest(callback, { headers: { cookie: a.cookie + '; ' + state } }),
        transport,
      )
    ).status,
  ).toBe(302);
  await expect(
    finishComposio(browserRequest(callback, { headers: { cookie: a.cookie + '; ' + state } }), transport),
  ).rejects.toMatchObject({ code: 'invalid_oauth_state' });
  expect(calls).toBe(1);
  expect(await transaction(a.p.organizationId, (tx) => resources.get(tx, 'connections', c.id))).toMatchObject(
    { status: 'healthy', identity_verified: true, account_identity: 'fixture-connected' },
  );
  const renamed = await transaction(a.p.organizationId, (tx) =>
    connections.saveConnection(tx, a.p, { name: 'Gmail Research' }, c.id),
  );
  expect(renamed).toMatchObject({
    id: c.id,
    status: 'healthy',
    identity_verified: true,
    account_identity: 'fixture-connected',
    name: 'Gmail Research',
  });
  await transaction(a.p.organizationId, (tx) => disconnectConnection(tx, a.p, c));
  expect(
    (
      await transaction(a.p.organizationId, (tx) =>
        resources.list(tx, 'connections', a.p, new URLSearchParams()),
      )
    ).data,
  ).toHaveLength(0);
  await expect(
    transaction(a.p.organizationId, (tx) => resources.get(tx, 'connections', c.id, a.p)),
  ).rejects.toMatchObject({ code: 'not_found' });
  let deletes = 0;
  await cleanConnection(
    a.p.organizationId,
    c.id,
    async () => {
      throw new Error('No HTTP expected');
    },
    async (external) => {
      expect(external).toBe('fixture-connected');
      deletes++;
      throw new Error('upstream unavailable');
    },
  );
  expect(await transaction(a.p.organizationId, (tx) => resources.get(tx, 'connections', c.id))).toMatchObject(
    { deleted: true, status: 'error', cleanup_status: 'retrying' },
  );
  await cleanConnection(
    a.p.organizationId,
    c.id,
    async () => {
      throw new Error('No HTTP expected');
    },
    async () => {
      deletes++;
    },
  );
  expect(deletes).toBe(2);
  expect(await transaction(a.p.organizationId, (tx) => resources.get(tx, 'connections', c.id))).toMatchObject(
    { cleanup_status: 'revoked', external_account_id: null, oauth_ciphertext: null },
  );
});

it('invalidates an earlier reconnect attempt without changing another named account', async () => {
  const rows = await transaction(a.p.organizationId, async (tx) =>
    Promise.all(
      ['Research', 'Personal'].map((name) =>
        connections.saveConnection(tx, a.p, {
          name,
          kind: 'composio',
          provider: 'gmail',
          auth_method: 'oauth',
        }),
      ),
    ),
  );
  const begin = (connection: string) =>
    startComposio(
      browserRequest(
        `${config.origin}/integrations/composio/install?connection_id=${connection}&organization_id=${a.p.organizationId}`,
        { headers: { cookie: a.cookie } },
      ),
    );
  const first = await begin(rows[0].id);
  const staleCookie = first.headers.get('set-cookie')!.split(';')[0];
  await begin(rows[0].id);
  const http = vi.fn<typeof fetch>();
  await expect(
    finishComposio(
      browserRequest(config.origin + '/integrations/composio/callback?session_uri=fixture', {
        headers: { cookie: a.cookie + '; ' + staleCookie },
      }),
      http,
    ),
  ).rejects.toMatchObject({ code: 'invalid_oauth_state' });
  expect(http).not.toHaveBeenCalled();
  expect(
    await transaction(a.p.organizationId, (tx) => resources.get(tx, 'connections', rows[1].id)),
  ).toMatchObject({ name: 'Personal', status: 'pending' });
  await expect(
    transaction(a.p.organizationId, (tx) =>
      connections.saveConnection(tx, { ...a.p, userId: b.p.userId }, { name: 'Stolen' }, rows[0].id),
    ),
  ).rejects.toMatchObject({ code: 'forbidden' });
  for (const row of rows) await transaction(a.p.organizationId, (tx) => disconnectConnection(tx, a.p, row));
});

it.each([
  { id: 'another-account' },
  { toolkit: { slug: 'slack' } },
  { status: 'EXPIRED' },
  { isDisabled: true },
])('does not authorize an unavailable or mismatched returning account (%j)', async (change) => {
  const c = await transaction(a.p.organizationId, (tx) =>
    connections.saveConnection(tx, a.p, {
      name: 'Unverified account',
      kind: 'composio',
      provider: 'gmail',
      auth_method: 'oauth',
    }),
  );
  const started = await startComposio(
    browserRequest(
      `${config.origin}/integrations/composio/install?connection_id=${c.id}&organization_id=${a.p.organizationId}`,
      { headers: { cookie: a.cookie } },
    ),
  );
  const accounts = connections.composio().connectedAccounts;
  const active = await accounts.get('fixture-connected');
  vi.spyOn(accounts, 'get').mockResolvedValueOnce({ ...active, ...change } as typeof active);
  await expect(
    finishComposio(
      browserRequest(config.origin + '/integrations/composio/callback?session_uri=fixture', {
        headers: { cookie: a.cookie + '; ' + started.headers.get('set-cookie')!.split(';')[0] },
      }),
      async () => Response.json({ connected_account_id: 'fixture-connected', toolkit_slug: 'gmail' }),
    ),
  ).rejects.toMatchObject({ code: 'connection_verification_failed' });
  expect(await transaction(a.p.organizationId, (tx) => resources.get(tx, 'connections', c.id))).toMatchObject(
    {
      status: 'pending',
      identity_verified: false,
      account_identity: null,
    },
  );
  await transaction(a.p.organizationId, (tx) => disconnectConnection(tx, a.p, c));
});

it.each(['reconnect', 'disconnect'] as const)(
  'cannot publish an old authorization after concurrent %s',
  async (action) => {
    const c = await transaction(a.p.organizationId, (tx) =>
      connections.saveConnection(tx, a.p, {
        name: 'Rotating account',
        kind: 'composio',
        provider: 'gmail',
        auth_method: 'oauth',
      }),
    );
    const begin = () =>
      startComposio(
        browserRequest(
          `${config.origin}/integrations/composio/install?connection_id=${c.id}&organization_id=${a.p.organizationId}`,
          { headers: { cookie: a.cookie } },
        ),
      );
    const started = await begin();
    await expect(
      finishComposio(
        browserRequest(config.origin + '/integrations/composio/callback?session_uri=fixture', {
          headers: { cookie: a.cookie + '; ' + started.headers.get('set-cookie')!.split(';')[0] },
        }),
        async () => {
          if (action === 'reconnect') await begin();
          else await transaction(a.p.organizationId, (tx) => disconnectConnection(tx, a.p, c));
          return Response.json({ connected_account_id: 'fixture-connected', toolkit_slug: 'gmail' });
        },
      ),
    ).rejects.toMatchObject({ code: action === 'reconnect' ? 'connection_changed' : 'not_found' });
    const saved = await transaction(a.p.organizationId, (tx) => resources.get(tx, 'connections', c.id));
    expect(saved.identity_verified).toBe(false);
    expect(saved.status).not.toBe('healthy');
    if (action === 'reconnect')
      await transaction(a.p.organizationId, (tx) => disconnectConnection(tx, a.p, c));
  },
);
