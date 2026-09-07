import { it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, credentialPool, transaction, credentialTransaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { seal, unseal } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import * as network from '../../packages/providers/src/network';
import { startMcpOAuth, finishMcpOAuth, withConnectionOAuth } from '../../packages/core/src/mcp-oauth';
import { saveConnection, connectionTools } from '../../packages/core/src/connections';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const browserRequest = (url: string, init: RequestInit) =>
  new Proxy(new Request(url, init), { get: (target, key) => Reflect.get(target, key, target) });
const endpoint = 'https://mcp.example.test/mcp';
let account: Awaited<ReturnType<typeof fixtureAccount>>, connection: resources.Document;
let verifier = '',
  challenge = '',
  exchanges = 0,
  refreshes = 0;
const transport: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname.includes('.well-known/oauth-protected-resource'))
    return Response.json({
      resource: endpoint,
      authorization_servers: [url.origin],
      scopes_supported: ['tools:read'],
    });
  if (url.pathname.includes('.well-known/oauth-authorization-server'))
    return Response.json({
      issuer: url.origin,
      authorization_endpoint: url.origin + '/authorize',
      token_endpoint: url.origin + '/token',
      registration_endpoint: url.origin + '/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  if (url.pathname === '/register')
    return Response.json({ ...JSON.parse(String(init?.body)), client_id: 'fixture-client' }, { status: 201 });
  if (url.pathname === '/token') {
    const params = new URLSearchParams(String(init?.body));
    expect(params.get('resource')).toBe(endpoint);
    if (params.get('grant_type') === 'authorization_code') {
      exchanges++;
      verifier = params.get('code_verifier')!;
      expect(params.get('code')).toBe('fixture-code');
      return Response.json({
        access_token: 'fixture-access',
        refresh_token: 'fixture-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
      });
    }
    refreshes++;
    expect(params.get('refresh_token')).toBe('fixture-refresh');
    return Response.json({
      access_token: 'rotated-access',
      refresh_token: 'rotated-refresh',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }
  if (url.pathname === '/mcp') {
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-access');
    if (init?.method === 'GET') return new Response(null, { status: 405 });
    const server = new Server({ name: 'fixture-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'read_note',
          description: 'Read fixture note',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }));
    const mcp = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(mcp);
    try {
      return await mcp.handleRequest(
        new Request(endpoint, { method: init?.method || 'POST', headers: init?.headers, body: init?.body }),
      );
    } finally {
      await server.close();
    }
  }
  throw new Error('Unexpected fixture URL');
};
beforeAll(async () => {
  vi.spyOn(network, 'validatePublicURL').mockImplementation(async (value) => ({
    url: new URL(value),
    addresses: [{ address: '93.184.216.34', family: 4 }],
  }));
  vi.spyOn(network, 'safeFetch').mockImplementation(transport);
  account = await fixtureAccount('MCP OAuth fixture');
  connection = await transaction(account.p.organizationId, (tx) =>
    saveConnection(tx, account.p, {
      name: 'Private MCP',
      kind: 'mcp_remote',
      auth_method: 'oauth',
      url: endpoint,
    }),
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await pool.end();
  await authPool.end();
  await credentialPool.end();
});
it('uses real SDK discovery, DCR, PKCE, browser binding, token storage, tool discovery and refresh rotation', async () => {
  const started = await startMcpOAuth(
    browserRequest(
      `${config.origin}/integrations/mcp/install?connection_id=${connection.id}&organization_id=${account.p.organizationId}`,
      { headers: { cookie: account.cookie } },
    ),
    transport,
  );
  expect(started.status).toBe(302);
  const authorization = new URL(started.headers.get('location')!);
  challenge = authorization.searchParams.get('code_challenge')!;
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  const state = authorization.searchParams.get('state')!,
    stateCookie = started.headers.get('set-cookie')!.split(';')[0];
  const callback = `${config.origin}/integrations/mcp/callback?code=fixture-code&state=${encodeURIComponent(state)}`;
  await expect(
    finishMcpOAuth(new Request(callback, { headers: { cookie: account.cookie } }), transport),
  ).rejects.toMatchObject({ code: 'invalid_oauth_state' });
  expect(exchanges).toBe(0);
  const request = () =>
    browserRequest(callback, { headers: { cookie: account.cookie + '; ' + stateCookie } });
  expect((await finishMcpOAuth(request(), transport)).status).toBe(302);
  expect(
    Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))).toString(
      'base64url',
    ),
  ).toBe(challenge);
  await expect(finishMcpOAuth(request(), transport)).rejects.toMatchObject({ code: 'invalid_oauth_state' });
  expect(exchanges).toBe(1);
  connection = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'connections', connection.id),
  );
  expect(connection.status).toBe('healthy');
  expect(String(connection.oauth_ciphertext)).not.toContain('fixture-access');
  expect((await connectionTools(connection)).map((t) => t.name)).toEqual(['read_note']);
  const expired = unseal<Record<string, unknown>>(String(connection.oauth_ciphertext));
  expired.expires = Date.now() - 1000;
  await transaction(account.p.organizationId, (tx) =>
    resources.update(tx, 'connections', connection.id, { oauth_ciphertext: seal(expired) }),
  );
  await withConnectionOAuth(connection, async (provider) => {
    expect(provider.tokens()?.access_token).toBe('rotated-access');
    return true;
  });
  expect(refreshes).toBe(1);
  const saved = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'connections', connection.id),
  );
  expect(
    unseal<{ tokens: { refresh_token: string } }>(String(saved.oauth_ciphertext)).tokens.refresh_token,
  ).toBe('rotated-refresh');
  await expect(
    transaction(account.p.organizationId, (tx) =>
      saveConnection(tx, account.p, { url: 'https://different.example.test/mcp' }, connection.id),
    ),
  ).rejects.toMatchObject({ code: 'connection_identity_immutable' });
}, 30000);
it('refreshes while every resource connection is occupied and preserves rotated credentials on caller rollback', async () => {
  let ready = 0;
  let release!: () => void;
  const callersReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      transaction(account.p.organizationId, async () => {
        if (++ready === 5) release();
        await callersReady;
        return withConnectionOAuth(connection, async (provider) => provider.tokens()?.access_token);
      }),
    ),
  );
  expect(results).toEqual(Array(5).fill('rotated-access'));
  await expect(
    transaction(account.p.organizationId, async () => {
      await withConnectionOAuth(connection, async (provider) => {
        provider.saveTokens({
          access_token: 'independent-access',
          refresh_token: 'independent-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      });
      throw new Error('Caller mutation rolled back');
    }),
  ).rejects.toThrow('Caller mutation rolled back');
  const saved = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'connections', connection.id),
  );
  expect(
    unseal<{ tokens: { refresh_token: string } }>(String(saved.oauth_ciphertext)).tokens.refresh_token,
  ).toBe('independent-refresh');
  await expect(
    credentialTransaction(crypto.randomUUID(), (tx) => resources.get(tx, 'connections', connection.id)),
  ).rejects.toMatchObject({ code: 'not_found' });
});
it('does not deadlock credential refresh behind storage maintenance waiting for its caller', async () => {
  let maintenance: Promise<unknown> | undefined;
  try {
    await transaction(account.p.organizationId, async (tx) => {
      const pid = (await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      maintenance = transaction(account.p.organizationId, async () => true, { exclusiveStorage: true });
      let waiting = false;
      for (let i = 0; i < 100 && !waiting; i++) {
        waiting = (
          await pool.query(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',
            [pid],
          )
        ).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect(await withConnectionOAuth(connection, async (provider) => provider.tokens()?.access_token)).toBe(
        'independent-access',
      );
    });
  } finally {
    await maintenance;
  }
});

async function pendingAuthorization() {
  const owner = await fixtureAccount('MCP failure boundary');
  const resource = await transaction(owner.p.organizationId, (tx) =>
    saveConnection(tx, owner.p, {
      name: 'Failure fixture',
      kind: 'mcp_remote',
      auth_method: 'oauth',
      url: endpoint,
    }),
  );
  const started = await startMcpOAuth(
    browserRequest(
      `${config.origin}/integrations/mcp/install?connection_id=${resource.id}&organization_id=${owner.p.organizationId}`,
      { headers: { cookie: owner.cookie } },
    ),
    transport,
  );
  expect(started.status).toBe(302);
  const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
  const cookie = started.headers.get('set-cookie')!.split(';')[0];
  const callback = () =>
    browserRequest(
      `${config.origin}/integrations/mcp/callback?code=fixture-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: owner.cookie + '; ' + cookie } },
    );
  return { owner, resource, state, cookie, callback };
}

it.each(['expired', 'wrong-browser', 'wrong-user', 'revoked-owner'] as const)(
  'rejects an OAuth callback with %s before exchanging its code',
  async (fault) => {
    const f = await pendingAuthorization();
    let request = f.callback();
    const before = exchanges;
    if (fault === 'expired') {
      const data = unseal<{ attempt: string }>(f.state);
      expect(
        (
          await transaction(f.owner.p.organizationId, (tx) =>
            tx.query("UPDATE oauth_attempts SET expires_at=now()-interval '1 second' WHERE id=$1", [
              data.attempt,
            ]),
          )
        ).rowCount,
      ).toBe(1);
    }
    if (fault === 'wrong-browser')
      request = new Request(request.url, { headers: { cookie: f.owner.cookie + '; mcp-state=wrong' } });
    if (fault === 'wrong-user') {
      const other = await fixtureAccount('Other OAuth browser');
      await pool.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'member')", [
        f.owner.p.organizationId,
        other.p.userId,
      ]);
      request = new Request(request.url, { headers: { cookie: other.cookie + '; ' + f.cookie } });
    }
    if (fault === 'revoked-owner')
      await transaction(f.owner.p.organizationId, (tx) =>
        resources.update(tx, 'connections', f.resource.id, { owner_subject_id: account.p.userId }),
      );
    await expect(finishMcpOAuth(request, transport)).rejects.toMatchObject({
      code: fault === 'revoked-owner' ? 'forbidden' : 'invalid_oauth_state',
    });
    expect(exchanges).toBe(before);
    const stored = await transaction(f.owner.p.organizationId, (tx) =>
      resources.get(tx, 'connections', f.resource.id),
    );
    expect(stored.status).not.toBe('healthy');
    expect(stored.oauth_ciphertext).toBeUndefined();
  },
);

it.each(['invalid_grant', 'lost-response'] as const)(
  'consumes the authorization code before %s and requires new consent',
  async (fault) => {
    const f = await pendingAuthorization();
    let attempts = 0;
    const failed: typeof fetch = async (input, init) => {
      if (new URL(String(input)).pathname === '/token') {
        attempts++;
        if (fault === 'lost-response') throw new Error('Connection lost after token exchange');
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      return transport(input, init);
    };
    await expect(finishMcpOAuth(f.callback(), failed)).rejects.toThrow();
    const initialExchanges = attempts;
    expect(initialExchanges).toBeGreaterThan(0);
    // The SDK may retry a definitive invalid_grant once; our consumed callback cannot replay either outcome.
    await expect(finishMcpOAuth(f.callback(), failed)).rejects.toMatchObject({ code: 'invalid_oauth_state' });
    expect(attempts).toBe(initialExchanges);
    const current = await transaction(f.owner.p.organizationId, (tx) =>
      resources.get(tx, 'connections', f.resource.id),
    );
    expect(current.status).not.toBe('healthy');
    expect(current.oauth_ciphertext).toBeUndefined();
  },
);

it('marks revoked upstream refresh credentials expired without executing a tool or replaying refresh', async () => {
  const f = await pendingAuthorization();
  expect((await finishMcpOAuth(f.callback(), transport)).status).toBe(302);
  const current = await transaction(f.owner.p.organizationId, (tx) =>
    resources.get(tx, 'connections', f.resource.id),
  );
  const data = unseal<Record<string, unknown>>(String(current.oauth_ciphertext));
  data.expires = Date.now() - 1;
  await transaction(f.owner.p.organizationId, (tx) =>
    resources.update(tx, 'connections', current.id, { oauth_ciphertext: seal(data) }),
  );
  let calls = 0;
  vi.mocked(network.safeFetch).mockImplementation(async (input, init) => {
    if (new URL(String(input)).pathname === '/token') {
      calls++;
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    return transport(input, init);
  });
  const tool = vi.fn(async () => 'must not execute');
  try {
    await expect(withConnectionOAuth(current, tool)).rejects.toThrow();
    expect(tool).not.toHaveBeenCalled();
    expect(calls).toBe(1);
    const saved = await transaction(f.owner.p.organizationId, (tx) =>
      resources.get(tx, 'connections', current.id),
    );
    expect(saved.status).toBe('expired');
    expect(unseal<Record<string, unknown>>(String(saved.oauth_ciphertext)).tokens).toBeUndefined();
    await expect(withConnectionOAuth(current, tool)).rejects.toMatchObject({ code: 'connection_expired' });
    expect(calls).toBe(1);
  } finally {
    vi.mocked(network.safeFetch).mockImplementation(transport);
  }
});
