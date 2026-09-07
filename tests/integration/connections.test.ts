import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { startComposio, finishComposio } from '../../packages/core/src/composio-auth';
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
  a = await fixtureAccount('Connector owner');
  b = await fixtureAccount('Other connector user');
  process.env.COMPOSIO_API_KEY = 'fixture-no-real-account';
  process.env.COMPOSIO_AUTH_CONFIGS_JSON = '{"gmail":"fixture-auth"}';
  process.env.COMPOSIO_CALLBACK_VERIFICATION_ENABLED = 'true';
  vi.spyOn(connections, 'composio').mockReturnValue({
    connectedAccounts: {
      link: async (user: string) => {
        expect(user).toBe(`${a.p.organizationId}:${a.p.userId}`);
        return { id: 'fixture-connected', redirectUrl: 'https://connect.composio.dev/fixture' };
      },
    },
  } as unknown as ReturnType<typeof connections.composio>);
});
afterAll(async () => {
  vi.restoreAllMocks();
  for (const key of [
    'COMPOSIO_API_KEY',
    'COMPOSIO_AUTH_CONFIGS_JSON',
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
  const grants = { version: 1, subject_type: 'user' as const, subject_id: a.p.userId };
  const outcomes = await Promise.allSettled([
    transaction(a.p.organizationId, (tx) =>
      connections.setGrants(tx, a.p, connection, { ...grants, tools: [] }),
    ),
    transaction(a.p.organizationId, (tx) =>
      connections.setGrants(tx, a.p, connection, { ...grants, tools: ['web_search'] }),
    ),
  ]);
  expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
    reason: { code: 'stale_revision' },
  });
  const stored = await transaction(a.p.organizationId, (tx) =>
    resources.get(tx, 'connections', connection.id),
  );
  expect(stored.grants).toEqual(outcomes.find((outcome) => outcome.status === 'fulfilled')?.value);
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
    { status: 'healthy', identity_verified: true },
  );
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
