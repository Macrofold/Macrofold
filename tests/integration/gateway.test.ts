import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { config } from '../../packages/core/src/config';
import { pool, authPool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { createWorkspace } from '../../packages/core/src/files';
import { admitRun, getRun } from '../../packages/core/src/runs';
import { handleModelRequest } from '../../packages/core/src/model-gateway';
import { runtimeToken } from '../../packages/core/src/runtime-auth';
import { credit, reserve } from '../../packages/core/src/ledger';

let p: Principal;
const original = { ...config };
const envNames = [
  'AUTH_SECRET',
  'VAULT_KEY',
  'DATABASE_URL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
];
const originalEnv = Object.fromEntries(envNames.map((k) => [k, process.env[k]]));
const model = {
  id: 'fixture-metered',
  name: 'Fixture metered',
  provider: 'openai',
  harnesses: ['codex'],
  input_micro_usd_per_million: '1000000',
  output_micro_usd_per_million: '2000000',
  enabled: true,
};
beforeAll(async () => {
  const user = (
    await auth.api.signUpEmail({
      body: {
        email: `gateway-${id()}@example.test`,
        password: 'gateway-fixture-password',
        name: 'Gateway fixture',
      },
    })
  ).user;
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  const org = (await pool.query('SELECT organization_id FROM memberships WHERE user_id=$1', [user.id]))
    .rows[0].organization_id;
  p = {
    id: user.id,
    userId: user.id,
    organizationId: org,
    role: 'owner',
    kind: 'user',
    scopes: customerScopes,
    projectIds: [],
    operator: false,
  };
  await transaction(org, (tx) => credit(tx, org, 100_000_000n, `fixture:${id()}`));
});
afterEach(async () => {
  vi.restoreAllMocks();
  Object.assign(config, original);
  for (const key of envNames) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  await pool.query('DELETE FROM provider_circuit_breakers WHERE key=$1', [
    `model:${model.provider}:${model.id}`,
  ]);
  await pool.query("UPDATE memberships SET role='owner' WHERE user_id=$1", [p.userId]);
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function prepared() {
  const runId = await transaction(p.organizationId, async (tx) => {
    const project = await resources.create(tx, 'projects', p.organizationId, { name: 'Gateway fixture' });
    const workspace = (await createWorkspace(tx, p, project.id, { name: 'main', branch: 'main' })).result as {
      workspace_id: string;
    };
    const run = await admitRun(tx, p, {
      workspace_id: workspace.workspace_id,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Fixture',
      limits: { max_cost_micro_usd: '2000000', timeout_seconds: 900 },
    });
    await reserve(tx, p.organizationId, 2_000_000n);
    await tx.query(
      "UPDATE runs SET config=config||$2::jsonb,status='running',deadline=now()+interval '15 minutes',lease_generation=1,reservation_micro_usd=2000000 WHERE id=$1",
      [run.run_id, JSON.stringify({ model: model.id, rate_card: model })],
    );
    return run.run_id;
  });
  // All outbound fetches in this suite are intercepted before enabling the production branch.
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('Unconfigured fixture request; network is forbidden');
  });
  config.mode = 'production';
  config.origin = 'https://fixture.invalid';
  config.allowPaid = true;
  config.secret = 'fixture-auth-secret-at-least-thirty-two';
  config.vaultKey = 'fixture-vault-secret-at-least-thirty-two';
  process.env.AUTH_SECRET = config.secret;
  process.env.VAULT_KEY = config.vaultKey;
  process.env.DATABASE_URL = original.databaseUrl;
  process.env.OPENAI_API_KEY = 'fixture-key-no-provider-account';
  const token = runtimeToken({
    organization: p.organizationId,
    run: runId,
    lease: '1',
    expires: Date.now() + 60_000,
  });
  const call = (extra: Record<string, unknown> = {}, path = 'v1/responses') =>
    handleModelRequest(
      new Request(`https://fixture.invalid/runtime/runs/${runId}/model/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.id,
          input: 'A local fixture',
          max_output_tokens: 100,
          stream: true,
          ...extra,
        }),
      }),
      runId,
      path,
    );
  return { runId, fetch, call };
}
describe('model gateway metering without provider calls', () => {
  it('holds a conservative bound and settles the exact observed token usage once', async () => {
    const s = await prepared();
    s.fetch.mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://api.openai.com/v1/responses');
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer fixture-key-no-provider-account',
      );
      return new Response(
        'data: ' +
          JSON.stringify({
            type: 'response.completed',
            response: {
              usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 0 } },
            },
          }) +
          '\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    const response = await s.call();
    expect(response.status).toBe(200);
    await response.text();
    const saved = await transaction(p.organizationId, async (tx) => ({
      run: await getRun(tx, s.runId),
      usage: (await tx.query('SELECT * FROM model_usage WHERE run_id=$1', [s.runId])).rows,
      budget: (
        await tx.query('SELECT model_reserved_micro_usd,budget_used_micro_usd FROM runs WHERE id=$1', [
          s.runId,
        ])
      ).rows[0],
    }));
    expect(saved.usage).toHaveLength(1);
    expect(saved.usage[0].input_tokens).toBe('100');
    expect(saved.usage[0].output_tokens).toBe('20');
    expect(saved.run.cost_micro_usd).toBe('140');
    expect(saved.budget.model_reserved_micro_usd).toBe('0');
  });
  it('records missing final usage as provisional and never substitutes a zero-cost estimate', async () => {
    const s = await prepared();
    s.fetch.mockResolvedValue(
      new Response('data: {"type":"response.output_text.delta","delta":"partial"}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    await (await s.call()).text();
    const usage = await transaction(
      p.organizationId,
      async (tx) => (await tx.query('SELECT * FROM model_usage WHERE run_id=$1', [s.runId])).rows[0],
    );
    expect(usage.completeness).toBe('missing');
    expect(usage.input_tokens).toBeNull();
    expect(BigInt(usage.cost_micro_usd)).toBeGreaterThan(0n);
    expect(usage.usage_details.provisional).toBe(true);
  });
  it('rejects unsupported billed content, missing BYOK and exhausted budgets before fetching', async () => {
    const s = await prepared();
    expect(
      (await s.call({ input: [{ type: 'input_image', image_url: 'https://example.test/image' }] })).status,
    ).toBe(400);
    expect(s.fetch).not.toHaveBeenCalled();
    await transaction(p.organizationId, (tx) =>
      tx.query("UPDATE runs SET config=jsonb_set(config,'{limits,max_cost_micro_usd}','\"1\"') WHERE id=$1", [
        s.runId,
      ]),
    );
    expect((await s.call()).status).toBe(402);
    expect(s.fetch).not.toHaveBeenCalled();
    await transaction(p.organizationId, (tx) =>
      tx.query('UPDATE runs SET config=config||\'{"billing_mode":"byok"}\'::jsonb WHERE id=$1', [s.runId]),
    );
    expect((await s.call()).status).not.toBe(200);
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('rejects server-executed tools and provider plugins before reserving or contacting upstream', async () => {
    const s = await prepared();
    for (const tool of [
      { type: 'code_interpreter', container: { type: 'auto' } },
      { type: 'mcp', server_url: 'https://example.test/mcp', server_label: 'external' },
      { type: 'shell', environment: { type: 'container_auto' } },
      { type: 'shell' },
      { type: 'namespace', name: 'hidden', tools: [{ type: 'code_interpreter' }] },
      { type: 'future_paid_tool' },
    ]) {
      const response = await s.call({ tools: [tool] });
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe('unsupported_model_content');
    }
    for (const [provider, path, extra] of [
      ['anthropic', 'v1/messages', { tools: [{ type: 'code_execution_20260120', name: 'code_execution' }] }],
      ['anthropic', 'v1/messages', { mcp_servers: [{ type: 'url', url: 'https://example.test/mcp' }] }],
      ['openrouter', 'v1/chat/completions', { plugins: [{ id: 'web' }] }],
      ['openai', 'v1/chat/completions', { web_search_options: {} }],
    ] as const) {
      await transaction(p.organizationId, (tx) =>
        tx.query("UPDATE runs SET config=jsonb_set(config,'{rate_card}',$2::jsonb) WHERE id=$1", [
          s.runId,
          JSON.stringify({ ...model, provider }),
        ]),
      );
      expect((await s.call(extra, path)).status).toBe(400);
    }
    expect(s.fetch).not.toHaveBeenCalled();
    const requests = await transaction(p.organizationId, (tx) =>
      tx.query('SELECT id FROM gateway_requests WHERE run_id=$1', [s.runId]),
    );
    expect(requests.rowCount).toBe(0);
  });
  it('preserves client tools for the native harness protocols', async () => {
    const s = await prepared();
    s.fetch.mockImplementation(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      expect(payload.tools.length).toBeGreaterThan(0);
      expect(payload.mcp_servers).toBeUndefined();
      expect(payload.plugins).toBeUndefined();
      expect(payload.container).toBeUndefined();
      return Response.json({ type: 'message', usage: { input_tokens: 10, output_tokens: 2 } });
    });
    process.env.ANTHROPIC_API_KEY = 'fixture-key-no-provider-account';
    process.env.OPENROUTER_API_KEY = 'fixture-key-no-provider-account';
    for (const [provider, path, tools] of [
      [
        'openai',
        'v1/responses',
        [
          { type: 'function', name: 'exec_command', parameters: { type: 'object' } },
          { type: 'custom', name: 'apply_patch' },
          { type: 'namespace', name: 'local', tools: [{ type: 'function', name: 'read' }] },
          { type: 'shell', environment: { type: 'local' } },
        ],
      ],
      [
        'anthropic',
        'v1/messages',
        [
          { name: 'Write', input_schema: { type: 'object' } },
          { type: 'bash_20250124', name: 'bash' },
        ],
      ],
      [
        'openrouter',
        'v1/chat/completions',
        [{ type: 'function', function: { name: 'bash', parameters: { type: 'object' } } }],
      ],
    ] as const) {
      await transaction(p.organizationId, (tx) =>
        tx.query("UPDATE runs SET config=jsonb_set(config,'{rate_card}',$2::jsonb) WHERE id=$1", [
          s.runId,
          JSON.stringify({ ...model, provider }),
        ]),
      );
      expect(
        (await s.call({ stream: false, tools, mcp_servers: [], plugins: [], container: null }, path)).status,
      ).toBe(200);
    }
    expect(s.fetch).toHaveBeenCalledTimes(3);
  });
  it('rejects a stale execution lease and requests after persistence begins', async () => {
    const s = await prepared();
    await transaction(p.organizationId, (tx) =>
      tx.query("UPDATE runs SET status='persisting' WHERE id=$1", [s.runId]),
    );
    expect((await s.call()).status).toBe(409);
    await transaction(p.organizationId, (tx) =>
      tx.query("UPDATE runs SET status='running',lease_generation=2 WHERE id=$1", [s.runId]),
    );
    expect((await s.call()).status).toBe(409);
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('rechecks account authority before model side effects', async () => {
    const s = await prepared();
    await pool.query("UPDATE memberships SET role='viewer' WHERE user_id=$1", [p.userId]);
    expect((await s.call()).status).toBe(403);
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('caps an anomalous provider bill, stops the run and pauses the model', async () => {
    const s = await prepared();
    s.fetch.mockResolvedValue(Response.json({ usage: { input_tokens: 1000000, output_tokens: 1000000 } }));
    expect((await s.call({ stream: false })).status).toBe(200);
    const state = await transaction(p.organizationId, async (tx) => ({
      run: await getRun(tx, s.runId),
      request: (await tx.query('SELECT * FROM gateway_requests WHERE run_id=$1', [s.runId])).rows[0],
      usage: (await tx.query('SELECT usage_details FROM model_usage WHERE run_id=$1', [s.runId])).rows[0],
    }));
    expect(state.run.cancel_requested).toBe(true);
    expect(state.request.actual_micro_usd).toBe(state.request.reserved_micro_usd);
    expect(state.usage.usage_details.bound_breached).toBe(true);
    const breaker = await pool.query(
      'SELECT * FROM provider_circuit_breakers WHERE key=$1 AND resolved_at IS NULL',
      [`model:${model.provider}:${model.id}`],
    );
    expect(breaker.rowCount).toBe(1);
  });
});
