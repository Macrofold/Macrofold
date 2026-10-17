import assert from 'node:assert/strict';
import { config, isLocal } from '../../packages/core/src/config';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../../tests/fixtures/account';
import { fixtureHttpApi } from '../../tests/fixtures/http-api';
import { decisionExample } from '../../examples/decisions/contracts';
import { Client } from '../../sdk/typescript/src/index';
import * as resources from '../../packages/core/src/resources';
import { createKey } from '../../packages/core/src/keys';
import { credit } from '../../packages/core/src/ledger';
import { saveConnection } from '../../packages/core/src/connections';
import { charge, check } from './guard';
import { tracingEnabled, shutdownTracing } from '../../packages/core/src/tracing';
import { traceIdentity } from '../../packages/providers/src/langfuse';
import { ensureCustomerAgent } from '../../packages/core/src/customer-agents';
import { admitRun, getRun } from '../../packages/core/src/runs';
import { executeRun } from '../../packages/core/src/engine';
import { Simulator } from '../../packages/providers/src/execution';

assert(process.env.LIVE_FIXTURE_CHILD === '1' && isLocal());
assert(/^\/platform_test_[a-f0-9]+$/.test(new URL(config.databaseUrl).pathname));
const secret = process.env.OPENROUTER_API_KEY;
assert(secret, 'OPENROUTER_API_KEY is required.');
const model = process.env.LIVE_DECISION_MODEL || 'typesafe/jev-1.13';
assert(
  ['typesafe/jev-1.13', 'microsoft/microsoft-decision-1'].includes(model),
  'Choose a reviewed live fixture model.',
);
const microsoft = model === 'microsoft/microsoft-decision-1';
const label = microsoft ? 'decision-1' : 'jev';
if (process.env.TRACING_ENABLED === 'true')
  assert(tracingEnabled(), 'All Langfuse credentials are required for trace acceptance.');
const originalPaid = config.allowPaid;
const nativeFetch = globalThis.fetch;
const api = await fixtureHttpApi();
let calls = 0;
// Every paid call uses the reviewed $0.042/M input-only price and bounded questions.
// No retries; even a failed/uncertain request consumes its reserved test ceiling.
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin === api.origin) return nativeFetch(input, init);
  assert.equal(url.href, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(init?.method, 'POST');
  assert.equal(init.redirect, 'error');
  if (new Headers(init.headers).get('authorization') !== `Bearer ${secret}`)
    throw new Error('The decision adapter did not use the selected OpenRouter credential.');
  const body = JSON.parse(String(init.body));
  assert.equal(body.model, model);
  assert.deepEqual(Object.keys(body).sort(), ['model', 'provider', 'questions', 'state']);
  if (microsoft && calls === 0)
    assert.deepEqual(Object.keys(body.questions).sort(), ['is_bug', 'team', 'urgency']);
  else assert.deepEqual(Object.keys(body.questions), ['decision']);
  assert(
    Object.values(body.questions).every(
      (q) =>
        q && typeof q === 'object' && 'type' in q && ['noul', 'choice', 'score'].includes(String(q.type)),
    ),
  );
  assert.deepEqual(body.provider, {
    allow_fallbacks: false,
    max_price: { prompt: 0.042, completion: 0, request: 0 },
  });
  assert(Buffer.byteLength(String(init.body)) < 6000);
  assert(calls < 2, 'Only two live requests are authorized by this fixture.');
  charge('openrouter', `${label}-decision`, 2000); // Full 32K context at $0.042/M costs under $0.002.
  calls++;
  return nativeFetch(input, {
    ...init,
    signal: AbortSignal.any([init.signal!, AbortSignal.timeout(30_000)]),
  });
};
try {
  const { p } = await fixtureAccount('Live decision model');
  const setup = await transaction(p.organizationId, async (tx) => {
    await credit(tx, p.organizationId, 100_000n, 'live-decision-fixture');
    const workspace = await resources.create(tx, 'workspaces', p.organizationId, {
      name: 'Live decision fixture',
    });
    const key = await createKey(tx, p, {
      name: 'Decision app',
      workspace_id: workspace.id,
      scopes: ['runs:read', 'runs:write'],
    });
    const connection = await saveConnection(tx, p, {
      name: 'OpenRouter BYOK',
      kind: 'model',
      provider: 'openrouter',
      auth_method: 'api_key',
      secret,
    });
    return { workspace, key, connection };
  });
  const client = new Client({ baseURL: api.origin, apiKey: setup.key.secret });
  config.allowPaid = true;
  for (const kind of ['choice', 'score'] as const) {
    await check('openrouter', `${label}-${kind}`, async () => {
      const byok = kind === 'score';
      const body = decisionExample(setup.workspace.id, 'triage');
      body.model_binding = {
        provider: 'openrouter',
        model,
        billing_mode: byok ? 'byok' : 'managed',
        ...(byok ? { provider_connection_id: setup.connection.id } : {}),
      };
      body.definition.allowed_models = [{ provider: 'openrouter', model }];
      body.definition.limits = { max_cost_micro_usd: '2000', max_output_tokens: 256, timeout_seconds: 30 };
      if (byok) {
        process.env.OPENROUTER_API_KEY = ''; // Prove no managed fallback is needed.
        body.definition.question = {
          kind: 'score',
          criteria: ['No evidence', 'Some evidence', 'Strong evidence'],
        };
        body.definition.output_schema = { type: 'number', minimum: 0, maximum: 2 };
        body.definition.unknown_values = [];
      }
      const before = calls;
      const accepted = await client.inferences.create(
        microsoft && !byok
          ? {
              workspace_id: setup.workspace.id,
              model_binding: body.model_binding,
              limits: body.definition.limits,
              input: {
                state: 'Checkout returns a server error every time. Customers cannot complete a purchase.',
                questions: {
                  is_bug: { type: 'noul', instructions: 'Does this describe broken software?' },
                  team: {
                    type: 'choice',
                    instructions: 'Which team should investigate?',
                    criteria: { engineering: 'Errors and outages', billing: 'Invoice questions' },
                  },
                  urgency: {
                    type: 'score',
                    instructions: 'How urgent is this?',
                    criteria: ['Low', 'Medium', 'High'],
                  },
                },
              },
            }
          : body,
      );
      assert.equal(accepted.status, 'succeeded');
      assert(accepted.result, 'The original HTTP call must include its settled result.');
      const result = accepted.result;
      assert.deepEqual((await client.runs.getResult(accepted.run_id)).inference, result.inference);
      assert.equal(calls - before, 1);
      assert.equal(result.execution_outcome, 'success');
      assert(['value', 'unknown'].includes(result.inference?.outcome || ''));
      assert(result.inference?.provider_request_id);
      assert.equal(result.inference.transformation_version, 'openrouter-decisions/1');
      if (microsoft && !byok) {
        const value = result.inference.value as { answers: Record<string, { type: string }> };
        assert.equal(value.answers.is_bug.type, 'noul');
        assert.equal(value.answers.team.type, 'choice');
        assert.equal(value.answers.urgency.type, 'score');
      }
      const usage = await transaction(p.organizationId, async (tx) => ({
        run: (
          await tx.query('SELECT cost_micro_usd,budget_used_micro_usd FROM runs WHERE id=$1', [
            accepted.run_id,
          ])
        ).rows[0],
        tokens: (
          await tx.query('SELECT input_tokens,output_tokens,completeness FROM model_usage WHERE run_id=$1', [
            accepted.run_id,
          ])
        ).rows[0],
      }));
      assert.equal(usage.tokens.completeness, 'complete');
      assert(BigInt(usage.run.budget_used_micro_usd) > 0n);
      if (byok) assert.equal(usage.run.cost_micro_usd, '0');
      return {
        ...(tracingEnabled()
          ? {
              traceId: traceIdentity(p.organizationId, accepted.run_id).traceId,
              runId: accepted.run_id,
              workspaceId: setup.workspace.id,
              organizationId: p.organizationId,
            }
          : {}),
        billingMode: body.model_binding.billing_mode,
        model,
        outcome: result.inference.outcome,
        modelRevision: result.inference.model_revision,
        providerRequestId: result.inference.provider_request_id,
        ...usage,
      };
    });
  }
  if (tracingEnabled())
    await check('langfuse', 'customer-run', async () => {
      config.allowPaid = false;
      const binding = await transaction(p.organizationId, (tx) =>
        ensureCustomerAgent(tx, p, 'trace-customer', {
          key: 'assistant',
          name: 'Trace customer assistant',
          configuration: {
            harness: 'codex',
            model: 'fixture-model',
            billing_mode: 'managed',
            limits: { max_cost_micro_usd: '2000000', timeout_seconds: 900 },
          },
        }),
      );
      const accepted = await transaction(p.organizationId, (tx) =>
        admitRun(tx, p, {
          worktree_id: binding.worktree_id,
          agent_id: binding.agent_id,
          prompt: 'Synthetic Langfuse verification: summarize the fixture.',
        }),
      );
      await executeRun(p.organizationId, accepted.run_id, new Simulator());
      const run = await transaction(p.organizationId, (tx) => getRun(tx, accepted.run_id));
      assert.equal(run.status, 'succeeded');
      return {
        traceId: traceIdentity(p.organizationId, run.id).traceId,
        runId: run.id,
        workspaceId: binding.workspace_id,
        worktreeId: binding.worktree_id,
        customerId: 'trace-customer',
        customerBindingId: binding.id,
      };
    });
} finally {
  globalThis.fetch = nativeFetch;
  config.allowPaid = originalPaid;
  await shutdownTracing();
  await api.close();
  await pool.end();
  await authPool.end();
  await credentialPool.end();
}
