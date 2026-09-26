import { fixtureConnector, fixtureOperator } from '../fixtures/operator';
import { it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { seal } from '../../packages/core/src/crypto';
import { credit } from '../../packages/core/src/ledger';
import * as accessResolution from '../../packages/core/src/connection-access-resolution';
import { patchAccess, saveRule } from '../../packages/core/src/connection-access';
import { executeGrantedTool, handleRuntimeMcp, exposedToolName } from '../../packages/core/src/tool-broker';
import { runtimeToken, type RuntimeCapability } from '../../packages/core/src/runtime-auth';
import { admitRun } from '../../packages/core/src/runs';
import { createWorktree } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import * as network from '../../packages/providers/src/network';
import * as connections from '../../packages/core/src/connections';
import { searchTool } from '../../packages/contracts/search';
import type { SearchProviderId } from '../../packages/contracts/search';
import { searchFixtures } from '../fixtures/search';
import { approvedStdio } from '../../packages/core/src/stdio-catalog';
import { harnessNames, type HarnessName } from '../../packages/contracts/harnesses';
import type { AgentPermissions } from '../../packages/contracts/permissions';
const original = { ...config },
  env = { ...process.env };
let account: Awaited<ReturnType<typeof fixtureAccount>>;
beforeAll(async () => {
  await fixtureConnector();
  account = await fixtureAccount('Broker fixtures');
  // A simulated admission holds no credit; priced platform tools still require funding.
  await transaction(account.p.organizationId, tx =>
    credit(tx, account.p.organizationId, 10000000n, `broker-fixture:${account.p.organizationId}`));
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
    'COMPOSIO_MICRO_USD_PER_CALL',
  ]) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
});
it.each([undefined, 'customer_opaque-app-subject'])(
  'pins connector execution to its account and bound provider subject (%s)',
  async (subject) => {
    const fixture = await prepared('composio');
    if (subject)
      await transaction(fixture.p.organizationId, (tx) =>
        resources.update(tx, 'connections', fixture.connection.id, { provider_subject_id: subject }),
      );
    process.env.COMPOSIO_MICRO_USD_PER_CALL = '0';
    const second = await transaction(fixture.p.organizationId, async (tx) => {
      const first = fixture.connection;
      return resources.create(tx, 'connections', fixture.p.organizationId, {
        ...first,
        name: 'Personal',
        external_account_id: 'personal-account',
      });
    });
    const execute = vi.fn(async () => ({ data: { account: 'research' }, successful: true }));
    vi.spyOn(connections, 'composio').mockReturnValue({ tools: { execute } } as unknown as ReturnType<
      typeof connections.composio
    >);
    await executeGrantedTool(
      fixture.cap,
      fixture.connection.id,
      fixture.tool,
      { message: 'Read research' },
      'named-1',
    );
    expect(execute.mock.calls[0]).toEqual([
      fixture.tool.name,
      {
        userId: subject || `${fixture.p.organizationId}:${fixture.p.userId}`,
        connectedAccountId: 'research-account',
        version: 'fixture-version',
        arguments: { message: 'Read research' },
      },
      { signal: expect.any(AbortSignal) },
    ]);
    await expect(
      executeGrantedTool(fixture.cap, second.id, fixture.tool, { message: 'Read personal' }, 'named-2'),
    ).rejects.toMatchObject({ code: 'tool_not_granted' });
    await transaction(fixture.p.organizationId, (tx) =>
      resources.update(tx, 'connections', fixture.connection.id, { status: 'expired' }),
    );
    await expect(
      executeGrantedTool(fixture.cap, fixture.connection.id, fixture.tool, { message: 'Retry' }, 'named-3'),
    ).rejects.toMatchObject({ code: 'tool_not_granted' });
    expect(execute).toHaveBeenCalledOnce();
  },
);
afterAll(async () => {
  await fixtureOperator((db) => db.query("DELETE FROM connector_enablement WHERE toolkit='gmail'"));
  await pool.end();
  await authPool.end();
});
async function prepared(
  kind: 'search' | 'mcp_remote' | 'mcp_stdio' | 'composio' = 'search',
  byok = false,
  provider: SearchProviderId = 'brave',
  policy?: { harness: HarnessName; permissions: AgentPermissions },
) {
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
      provider: kind === 'composio' ? 'gmail' : provider,
      ...(kind === 'composio' ? { external_account_id: 'research-account', identity_verified: true } : {}),
      auth_method: byok ? 'api_key' : 'none',
      secret_ciphertext: byok ? seal('customer-fixture-key') : undefined,
      url: kind === 'mcp_remote' ? 'https://fixture.invalid/mcp' : undefined,
      status: 'healthy',
      owner_subject_id: p.userId,
      package: '@modelcontextprotocol/server-filesystem',
      package_version: '2026.8.31',
      access_version: '1',
      access_organization_wide: false,
      access_tools: [tool.name],
    });
    const workspace = await resources.create(tx, 'workspaces', p.organizationId, { name: 'Tool broker' });
    await saveRule(tx, p, connection.id, { scope: 'workspace', workspace_id: workspace.id }, '"1"');
    const worktree = (await createWorktree(tx, p, workspace.id, { name: 'main', branch: 'main' })).result as {
      worktree_id: string;
    };
    const run = await admitRun(tx, p, {
      worktree_id: worktree.worktree_id,
      harness: policy?.harness || 'codex',
      permissions: policy?.permissions,
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
      ...(policy ? {} : { connection_grants: [{ connection_id: connection.id, tools: [tool.name] }] }),
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
it.each(harnessNames)(
  '%s excludes connector tools from discovery and denies direct calls before billing',
  async (harness) => {
    const a = await prepared('search', false, 'brave', {
      harness,
      permissions: { version: 1, tools: { exclude: ['**/web_search'] } },
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(config.origin + '/runtime/runs/' + a.runId + '/mcp'),
      {
        requestInit: { headers: { Authorization: 'Bearer ' + runtimeToken(a.cap) } },
        fetch: async (input, init) => handleRuntimeMcp(new Request(input, init), a.runId),
      },
    );
    const client = new Client({ name: 'permission-fixture', version: '1' });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools).toHaveLength(0);
      await expect(
        executeGrantedTool(a.cap, a.connection.id, a.tool, { query: 'Forbidden' }, 'excluded'),
      ).rejects.toMatchObject({ code: 'tool_not_granted' });
      expect(a.http).not.toHaveBeenCalled();
      const saved = await transaction(a.p.organizationId, async (tx) => ({
        run: (await tx.query('SELECT cost_micro_usd FROM runs WHERE id=$1', [a.runId])).rows[0],
        invocations: (await tx.query('SELECT id FROM tool_invocations WHERE run_id=$1', [a.runId])).rows,
      }));
      expect(saved).toEqual({ run: { cost_micro_usd: '0' }, invocations: [] });
    } finally {
      await client.close();
    }
  },
);
it.each(searchFixtures)(
  '$provider BYOK search traverses the authorized broker and records one invocation on replay',
  async (fixture) => {
    const a = await prepared('search', true, fixture.provider);
    a.http.mockImplementation(async (url, init) => {
      expect(String(url)).toBe(fixture.url);
      expect(new Headers(init?.headers).get(fixture.header)).toBe(
        fixture.header === 'Authorization' ? 'Bearer customer-fixture-key' : 'customer-fixture-key',
      );
      return Response.json(fixture.response([fixture.row]));
    });
    const args = { query: 'docs & typescript', count: 2 };
    const first = await executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'provider-search');
    expect(first).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query: args.query,
            results: [{ title: 'Source', url: 'https://example.com', description: 'First\nSecond' }],
          }),
        },
      ],
    });
    expect(await executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'provider-search')).toEqual(first);
    expect(a.http).toHaveBeenCalledOnce();
    const invocations = await transaction(a.p.organizationId, (tx) =>
      tx.query('SELECT status,cost_micro_usd FROM tool_invocations WHERE run_id=$1', [a.runId]),
    );
    expect(invocations.rows).toEqual([{ status: 'complete', cost_micro_usd: '0' }]);
    await transaction(a.p.organizationId, (tx) =>
      resources.update(tx, 'connections', a.connection.id, {
        access_version: '2',
        access_organization_wide: true,
        access_tools: [],
      }),
    );
    await expect(
      executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'revoked-search'),
    ).rejects.toMatchObject({ code: 'tool_not_granted' });
    expect(a.http).toHaveBeenCalledOnce();
  },
);
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
      access_version: '2',
      access_organization_wide: true,
      access_tools: [],
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
  const args = { path: '/worktree/note.txt', content: 'Persist this' };
  await executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'stdio-1', { invokeStdio: invoke });
  await executeGrantedTool(a.cap, a.connection.id, a.tool, args, 'stdio-1', { invokeStdio: invoke });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]).toEqual([
    { name: 'fixture-vm', sessionId: 'fixed-session', createdAt: expect.any(String) },
    expect.objectContaining({
      command: '/opt/platform/node_modules/.bin/mcp-server-filesystem',
      args: ['/worktree'],
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

it('rechecks a revocation committed between authorization and dispatch without a fee or provider call', async () => {
  const a = await prepared();
  const actual = accessResolution.runtimeConnectionTools;
  vi.spyOn(accessResolution, 'runtimeConnectionTools').mockImplementationOnce(async (...args) => {
    const allowed = await actual(...args);
    await transaction(a.p.organizationId, (tx) =>
      patchAccess(tx, a.p, a.connection.id, { tools: [] }, '"2"'),
    );
    return allowed;
  });
  await expect(
    executeGrantedTool(a.cap, a.connection.id, a.tool, { query: 'fixture' }, 'revocation-race'),
  ).rejects.toMatchObject({ code: 'tool_not_granted' });
  expect(a.http).not.toHaveBeenCalled();
  await transaction(a.p.organizationId, async (tx) => {
    expect((await tx.query('SELECT id FROM tool_invocations WHERE run_id=$1', [a.runId])).rows).toEqual([]);
    expect(
      (await tx.query('SELECT budget_used_micro_usd FROM runs WHERE id=$1', [a.runId])).rows[0]
        .budget_used_micro_usd,
    ).toBe('0');
  });
});
it('preserves a committed dispatch when access is revoked during the provider action', async () => {
  const a = await prepared();
  a.http.mockImplementationOnce(async () => {
    await transaction(a.p.organizationId, (tx) =>
      patchAccess(tx, a.p, a.connection.id, { tools: [] }, '"2"'),
    );
    return Response.json({ web: { results: [] } });
  });
  await executeGrantedTool(a.cap, a.connection.id, a.tool, { query: 'fixture' }, 'dispatch-first');
  expect(a.http).toHaveBeenCalledOnce();
  await transaction(a.p.organizationId, async (tx) =>
    expect(
      (await tx.query('SELECT status,cost_micro_usd FROM tool_invocations WHERE run_id=$1', [a.runId])).rows,
    ).toEqual([{ status: 'complete', cost_micro_usd: '6000' }]),
  );
  await expect(
    executeGrantedTool(a.cap, a.connection.id, a.tool, { query: 'fixture' }, 'after-revocation'),
  ).rejects.toMatchObject({ code: 'tool_not_granted' });
  expect(a.http).toHaveBeenCalledOnce();
});
