import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PerformanceRecord } from '../packages/contracts/performance';
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
    { seal, id },
    { runtimeToken },
    { handleRuntimeMcp, exposedToolName },
    { connectionToolCatalog },
    { configurePerformance, capturePerformanceTicket, runPerformanceRoot },
    { observeDatabasePools },
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
    import('../packages/core/src/performance'),
    import('../packages/db/diagnostics'),
  ]);
  assert(isLocal() && !config.allowPaid && config.execution === 'simulator');
  assert(/^\/platform_test_[a-f0-9]+$/.test(new URL(config.databaseUrl).pathname));
  let calls = 0;
  const protocolCounts = { discoveries: 0, tool_calls: 0 };
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
    if (message && typeof message === 'object' && 'method' in message) {
      if (message.method === 'tools/list') protocolCounts.discoveries++;
      if (message.method === 'tools/call') protocolCounts.tool_calls++;
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
  const originalFetch = globalThis.fetch;
  let client: Client | undefined;
  type Sample = {
    elapsed_ms: number;
    statements: number;
    groups: number;
    sql_parameter_known_bytes: number;
    sql_unknown_parameters: number;
    discoveries: number;
    tool_calls: number;
    profiles: PerformanceRecord[];
  };
  // The broker deliberately creates an independent request root. This fixture
  // trial tag associates its completed summaries without global time windows.
  const trials = new AsyncLocalStorage<Sample>();
  let droppedProfiles = 0;
  const profiler = configurePerformance({
    sampleRate: 1,
    durationSeconds: 300,
    sink: {
      enqueue(record) {
        const sample = trials.getStore();
        if (!sample || record.type !== 'operation' || record.state === 'started') return;
        if (sample.profiles.length >= 16) {
          droppedProfiles++;
          return;
        }
        sample.profiles.push(record);
      },
      flush: async () => {},
      close: async () => {},
    },
  });
  profiler.onClose(
    observeDatabasePools(
      [
        [pool, 'domain'],
        [authPool, 'identity'],
        [credentialPool, 'credential'],
      ],
      capturePerformanceTicket,
    ),
  );
  const measure = async <T>(action: () => Promise<T>) => {
    const sample: Sample = {
      elapsed_ms: 0,
      statements: 0,
      groups: 0,
      sql_parameter_known_bytes: 0,
      sql_unknown_parameters: 0,
      discoveries: 0,
      tool_calls: 0,
      profiles: [],
    };
    const before = { ...protocolCounts };
    const started = performance.now();
    try {
      const value = await trials.run(sample, () =>
        runPerformanceRoot('run', { requestId: id(), organizationId: org }, action),
      );
      return { sample, value };
    } finally {
      sample.elapsed_ms = performance.now() - started;
      sample.discoveries = protocolCounts.discoveries - before.discoveries;
      sample.tool_calls = protocolCounts.tool_calls - before.tool_calls;
      for (const profile of sample.profiles) {
        if (profile.phase === 'background') continue;
        sample.statements += profile.counters.statements ?? 0;
        sample.groups += profile.counters.groups ?? 0;
        sample.sql_parameter_known_bytes += profile.counters.parameter_bytes ?? 0;
        sample.sql_unknown_parameters += profile.counters.unknown_parameters ?? 0;
      }
    }
  };
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, origin, 'The profile must never make an external request');
      assert.equal(url.pathname, '/mcp', 'A selected tool must not discover the unrelated connection');
      return originalFetch(input, init);
    };
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
      warm.push(sample);
    }
    assert.equal(calls, 11);
    assert.equal(droppedProfiles, 0);
    assert(warm.every((sample) => sample.statements > 0 && sample.profiles.length > 0));
    const summary = (samples: Sample[]) => {
      const sorted = samples.map((sample) => sample.elapsed_ms).sort((a, b) => a - b);
      const average = (
        key: 'elapsed_ms' | 'statements' | 'groups' | 'sql_parameter_known_bytes' | 'sql_unknown_parameters',
      ) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
      return {
        samples: samples.length,
        mean_ms: average('elapsed_ms'),
        p50_ms: sorted[Math.floor(sorted.length / 2)],
        p95_ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        statements_mean: average('statements'),
        groups_mean: average('groups'),
        sql_parameter_known_bytes_mean: average('sql_parameter_known_bytes'),
        sql_unknown_parameters_mean: average('sql_unknown_parameters'),
        sql_parameter_text_bytes_mean: null,
        sql_result_json_bytes_mean: null,
        sql_wire_bytes_mean: null,
        discoveries: samples.reduce((sum, sample) => sum + sample.discoveries, 0),
        tool_calls: samples.reduce((sum, sample) => sum + sample.tool_calls, 0),
      };
    };
    console.log(
      JSON.stringify(
        {
          fixture: 'restricted_local_postgres_and_loopback_mcp',
          schema_version: 2,
          profiling: 'shared_correlated_collector',
          measurements_include_sql_byte_instrumentation: false,
          byte_measurement:
            'Known small scalar/buffer parameter bytes only; result and wire bytes are not measured.',
          native_admission_prompt_bytes: Buffer.byteLength(prompt),
          native_admission: summary(admission),
          native_admission_profiles: admission.map((sample) => sample.profiles),
          tool_cold: cold.sample,
          tool_warm: summary(warm),
          tool_warm_profiles: warm.map((sample) => sample.profiles),
          unrelated_discoveries: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await client?.close();
    await profiler.close();
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
