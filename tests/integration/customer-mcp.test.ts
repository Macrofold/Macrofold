import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleCustomerMcp } from '../../packages/core/src/customer-mcp';
import { customerMcpCatalog } from '../../packages/core/src/customer-mcp-catalog';
import { handleAdminMcp } from '../../packages/core/src/admin-mcp';
import { auth, identify } from '../../packages/core/src/auth';
import { config } from '../../packages/core/src/config';
import { pool, authPool, transaction } from '../../packages/db';
import { createKey } from '../../packages/core/src/keys';
import { executeRun } from '../../packages/core/src/engine';
import { fixtureAccount } from '../fixtures/account';
import type { ApiOperation, ApiResult } from '../../packages/core/src/api-types';
import { createHash, randomBytes } from 'node:crypto';
import { actorAuthorized } from '../../packages/core/src/actor-authorization';
import { getRun } from '../../packages/core/src/runs';
import { id } from '../../packages/core/src/crypto';
import { Client as ApiClient } from '../../sdk/typescript/src/client';
import { handleApi } from '../../packages/core/src/http';
import * as network from '../../packages/providers/src/network';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
const clients: Client[] = [];
const metadataClientId = 'https://desktop.example.test/oauth/client.json';
beforeAll(async () => {
  // Exercise the configured CIMD transport, without fetching real client documents in CI.
  vi.spyOn(network, 'safeFetch').mockImplementation(async (input) => {
    expect(String(input)).toBe(metadataClientId);
    return Response.json({
      client_id: metadataClientId,
      client_name: 'MCP metadata fixture',
      application_type: 'native',
      redirect_uris: ['http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });
  account = await fixtureAccount('Customer MCP');
});
afterAll(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.map((c) => c.close()));
  await pool.end();
  await authPool.end();
});
async function connect(key = account.key, onMutation?: () => void) {
  const client = new Client({ name: 'MCP acceptance', version: '1.0.0' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${config.origin}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${key}` } },
      fetch: async (url, init) => handleCustomerMcp(new Request(url, init), onMutation),
    }),
  );
  return client;
}
it('notifies the host to dispatch only after accepted mutations', async () => {
  const dispatch = vi.fn();
  const client = await connect(account.key, dispatch);
  await client.listTools();
  await call(client, 'listWorkspaces');
  await call(client, 'createWorkspace', { body: { name: 'Missing idempotency' } });
  expect(dispatch).not.toHaveBeenCalled();
  await call(client, 'createWorkspace', { idempotency_key: id(), body: { name: 'Dispatch accepted' } });
  expect(dispatch).toHaveBeenCalledTimes(1);
});
async function call<K extends ApiOperation>(client: Client, name: K, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  return result.structuredContent as { status: number; data: ApiResult<K>; request_id: string };
}
it('negotiates with the official SDK, paginates every authorized tool and rejects malformed requests', async () => {
  const client = await connect();
  expect(client.getInstructions()).toContain('idempotency_key');
  const names: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    names.push(...page.tools.map((t) => t.name));
    cursor = page.nextCursor;
  } while (cursor);
  expect(names).toEqual(customerMcpCatalog.map((e) => e.tool.name));
  await expect(client.listTools({ cursor: '-1' })).rejects.toThrow();
  expect((await client.callTool({ name: 'madeUpTool' })).isError).toBe(true);
  expect((await call(client, 'createWorkspace', { body: { name: 'Missing key' } })).status).toBe(400);
});
it('creates a workspace, executes and continues a run with duplicate submission protection, and reads its result', async () => {
  const client = await connect();
  const input = { idempotency_key: id(), body: { name: 'MCP workspace' } };
  const [created, replay] = await Promise.all([
    call(client, 'createWorkspace', input),
    call(client, 'createWorkspace', input),
  ]);
  expect(created.status).toBe(201);
  expect(created.data.id).toBe(replay.data.id);
  const runArgs = {
    idempotency_key: id(),
    body: {
      workspace_id: created.data.id,
      prompt: 'Create a note',
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
    },
  };
  const [accepted, repeated] = await Promise.all([
    call(client, 'createRun', runArgs),
    call(client, 'createRun', runArgs),
  ]);
  expect(accepted.status, JSON.stringify(accepted)).toBe(202);
  expect(accepted.data.run_id).toBe(repeated.data.run_id);
  await executeRun(account.p.organizationId, accepted.data.run_id);
  expect((await call(client, 'getRunResult', { run_id: accepted.data.run_id })).data.final).toBe(true);
  const next = await call(client, 'continueSession', {
    session_id: accepted.data.session_id,
    idempotency_key: id(),
    body: { prompt: 'Continue the note' },
  });
  expect(next.status, JSON.stringify(next)).toBe(202);
  await executeRun(account.p.organizationId, next.data.run_id);
  expect((await call(client, 'getRun', { run_id: next.data.run_id })).data.status).toBe('succeeded');
  const foreign = await connect((await fixtureAccount('Other tenant MCP')).key);
  expect((await call(foreign, 'getRun', { run_id: next.data.run_id })).status).toBe(404);
  const conflict = await call(client, 'createWorkspace', { ...input, body: { name: 'Different input' } });
  expect(conflict.status).toBe(409);
});
it('filters discovery by scope, enforces permissions on direct calls, and observes revocation', async () => {
  const key = await transaction(account.p.organizationId, (tx) =>
    createKey(tx, account.p, { name: 'Read only MCP', scopes: ['workspaces:read'] }),
  );
  const client = await connect(key.secret);
  expect((await client.listTools()).tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  expect(
    (await call(client, 'createWorkspace', { body: { name: 'Forbidden' }, idempotency_key: id() })).status,
  ).toBe(403);
  await pool.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [key.id]);
  await expect(client.listTools()).rejects.toThrow();
});
it('requires a bearer credential, rejects foreign origins and keeps operator MCP read-only', async () => {
  const request = (headers: HeadersInit = {}) =>
    new Request(`${config.origin}/mcp`, { method: 'POST', headers, body: '{}' });
  const unauthenticated = await handleCustomerMcp(request({ cookie: account.cookie }));
  expect(unauthenticated.status).toBe(401);
  expect(unauthenticated.headers.get('www-authenticate')).toContain('/oauth-protected-resource/mcp');
  expect(
    (
      await handleCustomerMcp(
        request({ authorization: `Bearer ${account.key}`, origin: 'https://attacker.invalid' }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await handleCustomerMcp(
        new Request(`${config.origin}/mcp`, { headers: { authorization: `Bearer ${account.key}` } }),
      )
    ).status,
  ).toBe(405);
  expect((await handleAdminMcp(request({ authorization: `Bearer ${account.key}` }))).status).toBe(401);
});
it('returns lossless text/binary files and private download links without following them', async () => {
  const client = await connect();
  const api = new ApiClient({
    baseURL: config.origin,
    apiKey: account.key,
    fetch: (url, init) => handleApi(new Request(url, init)),
    retries: 0,
  });
  const workspace = await api.workspaces.create({ name: 'MCP files' });
  const worktree = workspace.default_worktree_id!;
  for (const [path, content] of [
    ['note.md', Buffer.from('# Hello 🌍')],
    ['bytes.bin', Buffer.from([0, 255, 123])],
    ['large.txt', Buffer.alloc(65537, 65)],
  ] as const) {
    await api.worktrees.writeFile(worktree, {
      path,
      content,
      ifMatch: (await api.worktrees.get(worktree)).revision,
    });
    const result = await client.callTool({ name: 'readFile', arguments: { worktree_id: worktree, path } });
    if (path === 'large.txt') {
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ status: 413 });
    } else {
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        status: 200,
        data: {
          encoding: path === 'note.md' ? 'utf8' : 'base64',
          content: content.toString(path === 'note.md' ? 'utf8' : 'base64'),
          byte_size: content.length,
        },
      });
    }
  }
  const download = await client.callTool({
    name: 'readFile',
    arguments: { worktree_id: worktree, path: 'large.txt', download: true },
  });
  expect(download.isError).toBe(false);
  expect(download.structuredContent).toMatchObject({
    status: 302,
    data: { download_url: expect.stringContaining('/objects/') },
  });
});
it('bounds MCP bodies, rejects invalid JSON, and rejects out-of-range discovery cursors', async () => {
  const request = (body: string) =>
    new Request(`${config.origin}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body,
    });
  expect((await handleCustomerMcp(request('x'.repeat(1024 * 1024 + 1)))).status).toBe(413);
  expect((await handleCustomerMcp(request('{'))).status).toBe(400);
  const client = await connect();
  await expect(client.listTools({ cursor: '99999' })).rejects.toThrow();
});
it('registers public PKCE clients only for the customer MCP and rejects operator escalation', async () => {
  const register = (extra: Record<string, unknown> = {}) =>
    auth.handler(
      new Request(`${config.origin}/auth/oauth2/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Customer desktop fixture',
          application_type: 'native',
          redirect_uris: ['http://127.0.0.1:54321/callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          ...extra,
        }),
      }),
    );
  const response = await register();
  expect(response.status, await response.clone().text()).toBe(201);
  const registered = await response.json();
  const links = await pool.query('SELECT "resourceId" FROM auth."oauthClientResource" WHERE "clientId"=$1', [
    registered.client_id,
  ]);
  expect(links.rows).toEqual([{ resourceId: `${config.origin}/mcp` }]);
  expect((await register({ scope: 'metrics:read' })).ok).toBe(false);
  expect((await register({ resources: [`${config.origin}/admin/mcp`] })).ok).toBe(false);
  // API keys deliberately work on either customer transport, never on the operator resource.
  expect(
    (
      await identify(
        new Request(`${config.origin}/v1/me`, { headers: { authorization: `Bearer ${account.key}` } }),
        `${config.origin}/mcp`,
      )
    ).kind,
  ).toBe('api_key');
});

it.each(['DCR', 'CIMD'])(
  'uses %s, PKCE and audience-bound OAuth for runs, then rechecks grant revocation',
  async (method) => {
    const redirect = 'http://127.0.0.1:54322/callback';
    let client_id = metadataClientId;
    if (method === 'DCR') {
      const registration = await auth.handler(
        new Request(`${config.origin}/auth/oauth2/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            client_name: 'MCP OAuth fixture',
            application_type: 'native',
            redirect_uris: [redirect],
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          }),
        }),
      );
      expect(registration.status).toBe(201);
      client_id = (await registration.json()).client_id;
    }
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'identity:read workspaces:read workspaces:write runs:write runs:read',
      resource: `${config.origin}/mcp`,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      state: 'fixture',
    });
    const authorized = await auth.handler(
      new Request(`${config.origin}/auth/oauth2/authorize?${query}`, { headers: { cookie: account.cookie } }),
    );
    const location = authorized.headers.get('location');
    expect(location, await authorized.clone().text()).toBeTruthy();
    const consent = await auth.handler(
      new Request(`${config.origin}/auth/oauth2/consent`, {
        method: 'POST',
        headers: { cookie: account.cookie, origin: config.origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          accept: true,
          oauth_query: new URL(location!, config.origin).search.slice(1),
        }),
      }),
    );
    expect(consent.status, await consent.clone().text()).toBe(200);
    const callback = new URL((await consent.json()).url);
    const tokenResponse = await auth.handler(
      new Request(`${config.origin}/auth/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id,
          code: callback.searchParams.get('code')!,
          redirect_uri: redirect,
          code_verifier: verifier,
          resource: `${config.origin}/mcp`,
        }),
      }),
    );
    expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200);
    const { access_token } = await tokenResponse.json();
    await expect(
      identify(
        new Request(`${config.origin}/v1/me`, { headers: { authorization: `Bearer ${access_token}` } }),
      ),
    ).rejects.toThrow();
    const client = await connect(access_token);
    const workspace = await call(client, 'createWorkspace', {
      body: { name: 'OAuth MCP workspace' },
      idempotency_key: id(),
    });
    expect(workspace.status, JSON.stringify(workspace)).toBe(201);
    const accepted = await call(client, 'createRun', {
      idempotency_key: id(),
      body: {
        workspace_id: workspace.data.id,
        prompt: 'OAuth run',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      },
    });
    expect(accepted.status, JSON.stringify(accepted)).toBe(202);
    const run = await transaction(account.p.organizationId, (tx) => getRun(tx, accepted.data.run_id));
    expect(run.config.oauth_audience).toBe(`${config.origin}/mcp`);
    expect(await transaction(account.p.organizationId, (tx) => actorAuthorized(tx, run))).toBe(true);
    await pool.query('UPDATE auth."oauthAccessToken" SET revoked=now() WHERE id=$1', [
      run.config.oauth_token_id,
    ]);
    expect(await transaction(account.p.organizationId, (tx) => actorAuthorized(tx, run))).toBe(false);
    await expect(client.listTools()).rejects.toThrow();
    // Exercise the worker's revocation boundary and settle this fixture's queued reservation.
    await executeRun(account.p.organizationId, accepted.data.run_id);
    expect(
      await transaction(account.p.organizationId, (tx) => getRun(tx, accepted.data.run_id)),
    ).toMatchObject({
      status: 'failed',
      result: { failure_code: 'authorization_revoked' },
    });
  },
);
