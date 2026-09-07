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
