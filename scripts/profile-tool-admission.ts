import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import pg from 'pg';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { withFixtureDatabase } from './fixture-database';
import { command } from './coverage/processes';

// The parent enforces the unpaid local profile and creates a disposable DB.
// Every measured external tool request goes to the synthetic loopback server.
if (!process.argv.includes('--fixture')) {
  await withFixtureDatabase((env) =>
    command(['exec', 'tsx', 'scripts/profile-tool-admission.ts', '--fixture'], env),
  );
} else {
  const [
    { fixtureAccount, retireFixtureRuns },
    { transaction, pool, authPool, credentialPool },
    resources,
    { createWorktree },
    { admitRun },
    { config, isLocal },
    { seal },
    { runtimeToken },
    { handleRuntimeMcp, exposedToolName },
    { connectionToolCatalog },
  ] = await Promise.all([
    import('../tests/fixtures/account'),
    import('../packages/db'),
    import('../packages/core/src/resources'),
    import('../packages/core/src/files'),
    import('../packages/core/src/runs'),
    import('../packages/core/src/config'),
    import('../packages/core/src/crypto'),
    import('../packages/core/src/runtime-auth'),
    import('../packages/core/src/tool-broker'),
    import('../packages/core/src/connection-tool-catalog'),
  ]);
  assert(isLocal() && !config.allowPaid && config.execution === 'simulator');
  assert(/^\/platform_test_[a-f0-9]+$/.test(new URL(config.databaseUrl).pathname));
  let calls = 0;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/mcp', 'A selected tool must not discover the unrelated connection');
    assert.equal(request.headers.authorization, 'Bearer synthetic-tool-profile');
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const message: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (current && message && typeof message === 'object' && 'method' in message) {
      if (message.method === 'tools/list') current.discoveries++;
      if (message.method === 'tools/call') current.tool_calls++;
    }
    const upstream = new McpServer({ name: 'synthetic-tool-profile', version: '1' });
    upstream.registerTool('read_customer_notes', { inputSchema: {} }, async () => {
      calls++;
      return { content: [{ type: 'text' as const, text: 'Synthetic fixture note' }] };
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await upstream.connect(transport);
      await transport.handleRequest(request, response, message);
    } finally {
      await upstream.close();
      await transport.close();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  process.env.LOCAL_MCP_ALLOWED_ORIGINS = origin;
  const account = await fixtureAccount('Synthetic broker profile');
  const org = account.p.organizationId;
  const originalQuery = pg.Client.prototype.query;
  const originalFetch = globalThis.fetch;
  let client: Client | undefined;
  type Sample = {
    elapsed_ms: number;
    statements: number;
    sql_parameter_text_bytes: number;
    sql_result_json_bytes: number;
    discoveries: number;
    tool_calls: number;
  };
  let current: Sample | undefined;
  const bytes = (value: unknown) =>
    Buffer.byteLength(
      JSON.stringify(value, (_key, entry: unknown) =>
        typeof entry === 'bigint' ? entry.toString() : entry,
      ) ?? '',
    );
  const measure = async <T>(action: () => Promise<T>) => {
    const sample: Sample = {
      elapsed_ms: 0,
      statements: 0,
      sql_parameter_text_bytes: 0,
      sql_result_json_bytes: 0,
      discoveries: 0,
      tool_calls: 0,
    };
    current = sample;
    const started = performance.now();
    try {
      return { sample, value: await action() };
    } finally {
      sample.elapsed_ms = performance.now() - started;
      current = undefined;
    }
  };
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, origin, 'The profile must never make an external request');
      assert.equal(url.pathname, '/mcp', 'A selected tool must not discover the unrelated connection');
      return originalFetch(input, init);
    };
    // The typed Proxy preserves node-postgres overloads. It records only byte
    // counts, never SQL text, arguments, credentials, object names or row content.
    pg.Client.prototype.query = new Proxy(originalQuery, {
      apply(target, receiver: unknown, args: unknown[]) {
        const sample = current;
        if (sample) {
          sample.statements++;
          const first = args[0];
          const parameters = first && typeof first === 'object' && 'values' in first ? first.values : args[1];
          if (Array.isArray(parameters)) sample.sql_parameter_text_bytes += bytes(parameters);
        }
        const result: unknown = Reflect.apply(target, receiver, args);
        if (!(result instanceof Promise)) return result;
        return result.then((response: unknown) => {
          if (sample && response && typeof response === 'object' && 'rows' in response)
            sample.sql_result_json_bytes += bytes(response.rows);
          return response;
        });
      },
    });
    const fixture = await transaction(org, async (tx) => {
      const workspace = await resources.create(tx, 'workspaces', org, { name: 'Synthetic profile' });
      const connection = await resources.create(tx, 'connections', org, {
        name: 'Selected loopback tool',
        kind: 'mcp_remote',
        auth_method: 'bearer',
        url: origin + '/mcp',
        secret_ciphertext: seal('synthetic-tool-profile'),
        status: 'healthy',
        owner_subject_id: account.p.userId,
        access_version: '1',
        access_organization_wide: true,
        access_tools: ['read_customer_notes'],
      });
      const unrelated = await resources.create(tx, 'connections', org, {
        ...connection,
        name: 'Unrelated unavailable tool',
        url: origin + '/unrelated',
      });
      const worktrees: string[] = [];
      for (let index = 0; index < 9; index++) {
        const worktree = await createWorktree(tx, account.p, workspace.id, {
          name: `profile-${index}`,
          branch: `profile-${index}`,
        });
        assert(typeof worktree.result.worktree_id === 'string');
        worktrees.push(worktree.result.worktree_id);
      }
      return { connection, unrelated, worktrees };
    });
    const admission: Sample[] = [];
    let runId = '';
    const prompt = 'Synthetic profile input. '.repeat(2800); // 70,000 bytes
    for (const [index, worktree] of fixture.worktrees.entries()) {
      const { sample, value } = await measure(() =>
        transaction(org, (tx) =>
          admitRun(tx, account.p, {
            worktree_id: worktree,
            harness: 'codex',
            model: 'fixture-model',
            billing_mode: 'managed',
            prompt,
            connection_grants: [fixture.connection, fixture.unrelated].map((connection) => ({
              connection_id: connection.id,
              tools: ['read_customer_notes'],
            })),
          }),
        ),
      );
      runId = value.run_id;
      if (index) admission.push(sample);
    }
    await transaction(org, (tx) =>
      tx.query(
        "UPDATE runs SET status='running',lease_generation=1,deadline=now()+interval '5 minutes' WHERE id=$1",
        [runId],
      ),
    );
    config.allowPaid = true;
    config.execution = 'docker'; // only a gate; this profile never allocates compute
    const cap = {
      purpose: 'runtime' as const,
      organization: org,
      run: runId,
      lease: '1',
      expires: Date.now() + 60_000,
    };
    client = new Client({ name: 'synthetic-tool-profile', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.origin + `/runtime/runs/${runId}/mcp`), {
        requestInit: { headers: { Authorization: 'Bearer ' + runtimeToken(cap) } },
        fetch: async (input, init) => handleRuntimeMcp(new Request(input, init), runId),
      }),
    );
    const selected = client;
    connectionToolCatalog.invalidate();
    const invoke = () =>
      selected.callTool({
        name: exposedToolName(fixture.connection.id, 'read_customer_notes'),
        arguments: {},
      });
    const cold = await measure(invoke);
    assert(!cold.value.isError);
    assert.equal(cold.sample.discoveries, 1);
    const warm: Sample[] = [];
    for (let index = 0; index < 10; index++) {
      const { sample, value } = await measure(invoke);
      assert(!value.isError);
      assert.equal(sample.discoveries, 0);
      assert.equal(sample.tool_calls, 1);
      assert(sample.sql_result_json_bytes < 12_000, 'Tool authority must not download the 70 KB prompt');
      warm.push(sample);
    }
    assert.equal(calls, 11);
    const summary = (samples: Sample[]) => {
      const sorted = samples.map((sample) => sample.elapsed_ms).sort((a, b) => a - b);
      const average = (key: keyof Sample) =>
        samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
      return {
        samples: samples.length,
        mean_ms: average('elapsed_ms'),
        p50_ms: sorted[Math.floor(sorted.length / 2)],
        p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        statements_mean: average('statements'),
        sql_parameter_text_bytes_mean: average('sql_parameter_text_bytes'),
        sql_result_json_bytes_mean: average('sql_result_json_bytes'),
        discoveries: samples.reduce((sum, sample) => sum + sample.discoveries, 0),
        tool_calls: samples.reduce((sum, sample) => sum + sample.tool_calls, 0),
      };
    };
    console.log(
      JSON.stringify(
        {
          fixture: 'restricted_local_postgres_and_loopback_mcp',
          measurements_include_sql_byte_instrumentation: true,
          native_admission_prompt_bytes: Buffer.byteLength(prompt),
          native_admission: summary(admission),
          tool_cold: cold.sample,
          tool_warm: summary(warm),
          unrelated_discoveries: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await client?.close();
    current = undefined;
    pg.Client.prototype.query = originalQuery;
    globalThis.fetch = originalFetch;
    config.allowPaid = false;
    config.execution = 'simulator';
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await retireFixtureRuns(org);
    await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
  }
}
