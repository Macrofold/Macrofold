import { it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { seal } from '../../packages/core/src/crypto';
import { executeGrantedTool, handleRuntimeMcp, exposedToolName } from '../../packages/core/src/tool-broker';
import { runtimeToken, type RuntimeCapability } from '../../packages/core/src/runtime-auth';
import { admitRun } from '../../packages/core/src/runs';
import { createWorkspace } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import * as network from '../../packages/providers/src/network';
import * as connections from '../../packages/core/src/connections';
import { searchTool } from '../../packages/providers/src/search';
import { approvedStdio } from '../../packages/core/src/stdio-catalog';
const original = { ...config },
  env = { ...process.env };
let account: Awaited<ReturnType<typeof fixtureAccount>>;
beforeAll(async () => {
  account = await fixtureAccount('Broker fixtures');
});
afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(config, original);
  for (const key of [
    'BRAVE_SEARCH_API_KEY',
    'BRAVE_SEARCH_MICRO_USD_PER_CALL',
    'AUTH_SECRET',
    'VAULT_KEY',
    'DATABASE_URL',
  ]) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function prepared(kind: 'search' | 'mcp_remote' | 'mcp_stdio' = 'search', byok = false) {
  // Install an outbound-deny stub before exercising any production branch.
  const http = vi.spyOn(network, 'safeFetch').mockImplementation(async () => {
    throw new Error('No fixture configured; outbound access denied');
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Unexpected outbound fetch denied');
  });
  config.secret = 'fixture-secret-long-enough-for-authentication';
  config.vaultKey = 'fixture-vault-long-enough-for-encryption';
  process.env.AUTH_SECRET = config.secret;
  process.env.VAULT_KEY = config.vaultKey;
  process.env.DATABASE_URL = original.databaseUrl;
  process.env.BRAVE_SEARCH_API_KEY = 'platform-fixture-key';
  process.env.BRAVE_SEARCH_MICRO_USD_PER_CALL = '6000';
  const p = account.p,
    tool =
      kind === 'search'
        ? searchTool
        : kind === 'mcp_stdio'
          ? approvedStdio('@modelcontextprotocol/server-filesystem', '2026.8.31').tools[1]!
          : {
              name: 'send',
              description: 'Fixture side effect',
              input_schema: {
                type: 'object',
                properties: { message: { type: 'string' } },
                required: ['message'],
                additionalProperties: false,
              },
            };
  const result = await transaction(p.organizationId, async (tx) => {
    const connection = await resources.create(tx, 'connections', p.organizationId, {
      name: 'Fixture',
      kind,
      provider: 'brave',
      auth_method: byok ? 'api_key' : 'none',
      secret_ciphertext: byok ? seal('customer-fixture-key') : undefined,
      url: kind === 'mcp_remote' ? 'https://fixture.invalid/mcp' : undefined,
      status: 'healthy',
      owner_subject_id: p.userId,
      package: '@modelcontextprotocol/server-filesystem',
      package_version: '2026.8.31',
      grants: { version: 1, subject_type: 'user', subject_id: p.userId, tools: [tool.name] },
    });
    const project = await resources.create(tx, 'projects', p.organizationId, { name: 'Tool broker' });
    const workspace = (await createWorkspace(tx, p, project.id, { name: 'main', branch: 'main' })).result as {
      workspace_id: string;
    };
    const run = await admitRun(tx, p, {
      workspace_id: workspace.workspace_id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
      connection_grants: [{ connection_id: connection.id, tools: [tool.name] }],
      limits: { timeout_seconds: 60, max_cost_micro_usd: '2000000' },
    });
    await tx.query(
      "UPDATE runs SET status='running',deadline=now()+interval '5 minutes',lease_generation=1,execution_binding=$2 WHERE id=$1",
      [
        run.run_id,
        JSON.stringify({
          provider: 'vercel',
          phase: 'poll',
          machine: { name: 'fixture-vm', sessionId: 'fixed-session', createdAt: new Date().toISOString() },
        }),
      ],
    );
    return { connection, runId: run.run_id };
  });
  config.mode = 'production';
  config.origin = 'https://fixture.invalid';
  config.allowPaid = true;
  const cap: RuntimeCapability = {
    purpose: 'runtime',
    organization: p.organizationId,
    run: result.runId,
    lease: '1',
    expires: Date.now() + 60000,
  };
  return { ...result, p, cap, tool: { ...tool, granted: true }, http };
}
it('search is scoped, budgeted, replay-safe and uses the selected funding key without fallback', async () => {
  const a = await prepared();
  let requests = 0;
  a.http.mockImplementation(async (input, init) => {
    requests++;
    expect(String(input)).toContain('api.search.brave.com/res/v1/web/search');
    expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('platform-fixture-key');
    return Response.json({
      web: { results: [{ title: 'Fixture source', url: 'https://example.com', description: 'Evidence' }] },
    });
  });
  const args = { query: 'Fixture question' };
  const first = await executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'search-1');
  expect(await executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'search-1')).toEqual(first);
  expect(requests).toBe(1);
  const cost = await transaction(a.p.organizationId, (tx) =>
    tx.query('SELECT cost_micro_usd FROM runs WHERE id=$1', [a.runId]),
  );
  expect(cost.rows[0].cost_micro_usd).toBe('6000');
  await transaction(a.p.organizationId, (tx) =>
    tx.query(
      "UPDATE runs SET config=jsonb_set(config,'{limits,max_cost_micro_usd}','\"6000\"') WHERE id=$1",
      [a.runId],
    ),
  );
  await expect(executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'search-2')).rejects.toMatchObject({
    code: 'run_budget_exhausted',
  });
  expect(requests).toBe(1);
  await transaction(a.p.organizationId, (tx) =>
    resources.update(tx, 'connections', a.connection.id, { auth_method: 'api_key', secret_ciphertext: null }),
  );
  await expect(executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'search-3')).rejects.toMatchObject({
    code: 'search_not_configured',
  });
  expect(requests).toBe(1);
});
it('ambiguous external actions are never automatically replayed and revoked grants reject new actions', async () => {
  const a = await prepared('mcp_remote');
  let effects = 0;
  vi.spyOn(connections, 'withMcp').mockImplementation(async () => {
    effects++;
    throw new Error('Acknowledgement lost after side effect');
  });
  await expect(
    executeGrantedTool(a.cap, a.connection.id, a.tool, { message: 'Once' }, 'action-1'),
  ).rejects.toThrow('Acknowledgement lost');
  await expect(
    executeGrantedTool(a.cap, a.connection.id, a.tool, { message: 'Once' }, 'action-1'),
  ).rejects.toMatchObject({ code: 'tool_outcome_unknown' });
  await expect(
    executeGrantedTool(a.cap, a.connection.id, a.tool, { message: 'Changed' }, 'action-1'),
  ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  await transaction(a.p.organizationId, (tx) =>
    resources.update(tx, 'connections', a.connection.id, {
      grants: { version: 2, subject_type: 'user', subject_id: a.p.userId, tools: [] },
    }),
  );
  await expect(
    executeGrantedTool(a.cap, a.connection.id, a.tool, { message: 'Again' }, 'action-2'),
  ).rejects.toMatchObject({ code: 'tool_not_granted' });
  expect(effects).toBe(1);
});
it('official MCP client discovers only granted tools, preserves BYOK and rejects a revoked runtime actor', async () => {
  const a = await prepared('search', true);
  let requests = 0;
  a.http.mockImplementation(async (_input, init) => {
    requests++;
    expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('customer-fixture-key');
    return Response.json({ web: { results: [] } });
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(config.origin + '/runtime/runs/' + a.runId + '/mcp'),
    {
      requestInit: { headers: { Authorization: 'Bearer ' + runtimeToken(a.cap) } },
      fetch: async (input, init) => handleRuntimeMcp(new Request(input, init), a.runId),
    },
  );
  const client = new Client({ name: 'broker-fixture', version: '1' });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    expect(listed.tools).toHaveLength(1);
    expect(requests).toBe(0);
    const name = exposedToolName(a.connection.id, 'web_search');
    const result = await client.callTool({ name, arguments: { query: 'BYOK question' } });
    expect(result.isError).not.toBe(true);
    expect(requests).toBe(1);
    const cost = await transaction(a.p.organizationId, (tx) =>
      tx.query('SELECT cost_micro_usd FROM runs WHERE id=$1', [a.runId]),
    );
    expect(cost.rows[0].cost_micro_usd).toBe('0');
    await pool.query("UPDATE memberships SET role='viewer' WHERE organization_id=$1 AND user_id=$2", [
      a.p.organizationId,
      a.p.userId,
    ]);
    await expect(client.callTool({ name, arguments: { query: 'Denied' } })).rejects.toThrow();
    expect(requests).toBe(1);
  } finally {
    await client.close();
    await pool.query("UPDATE memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2", [
      a.p.organizationId,
      a.p.userId,
    ]);
  }
});
it('stdio calls use the existing sandbox, reviewed argv and the same durable invocation journal', async () => {
  const a = await prepared('mcp_stdio'),
    invoke = vi.fn(async () => ({ content: [{ type: 'text', text: 'Saved' }] }));
  const args = { path: '/workspace/note.txt', content: 'Persist this' };
  await executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'stdio-1', { invokeStdio: invoke });
  await executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'stdio-1', { invokeStdio: invoke });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]).toEqual([
    { name: 'fixture-vm', sessionId: 'fixed-session', createdAt: expect.any(String) },
    expect.objectContaining({
      command: '/opt/platform/node_modules/.bin/mcp-server-filesystem',
      args: ['/workspace'],
      environment: {},
      tool: 'write_file',
      arguments: args,
    }),
  ]);
  await expect(
    executeGrantedTool({ ...a.cap, lease: '2' }, a.connection.id, a.tool, args, 'stdio-2', {
      invokeStdio: invoke,
    }),
  ).rejects.toMatchObject({ code: 'run_unavailable' });
});
