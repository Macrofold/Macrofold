import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { authPool, pool, transaction } from '../../packages/db';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { config } from '../../packages/core/src/config';
import { id, unseal } from '../../packages/core/src/crypto';
import * as resources from '../../packages/core/src/resources';
import { createKey } from '../../packages/core/src/keys';
import { credit } from '../../packages/core/src/ledger';
import { admitInference } from '../../packages/core/src/inferences';
import { advanceInference } from '../../packages/core/src/inference-engine';
import { getRun } from '../../packages/core/src/runs';
import { decisionExample } from '../../examples/decisions/contracts';
import type { StoredDecisionResponse } from '../../packages/core/src/inference-invocations';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let workspaceId: string;
let caller: Awaited<ReturnType<typeof fixtureAccount>>['p'];
const originalPaid = config.allowPaid;
beforeAll(async () => {
  account = await fixtureAccount('Private inference evidence');
  await transaction(account.p.organizationId, async (tx) => {
    await credit(tx, account.p.organizationId, 100_000_000n, `evidence:${id()}`);
    workspaceId = (
      await resources.create(tx, 'workspaces', account.p.organizationId, { name: 'Evidence fixture' })
    ).id;
    const key = await createKey(tx, account.p, {
      name: 'Bounded evidence',
      workspace_id: workspaceId,
      scopes: ['runs:read', 'runs:write', 'files:read'],
    });
    caller = { ...account.p, id: key.id, kind: 'api_key', workspaceIds: [workspaceId], scopes: key.scopes };
  });
});
afterEach(async () => {
  config.allowPaid = originalPaid;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  if (account) await retireFixtureRuns(account.p.organizationId);
  await pool.end();
  await authPool.end();
});
it.each(['answer', 'usage'] as const)(
  'persists bounded-agent %s normalization failure before accounting without retrying provider execution',
  async (failure) => {
    const raw =
      failure === 'answer'
        ? { id: 'malformed-answer', content: 'malformed', usage: { input_tokens: 17, output_tokens: 3 } }
        : {
            id: 'malformed-usage',
            content: [{ type: 'text', text: '"wait"' }],
            usage: { input_tokens: 'bad', output_tokens: 0 },
          };
    const transport = vi.fn(async () => Response.json(raw));
    vi.stubGlobal('fetch', transport);
    vi.stubEnv('ANTHROPIC_API_KEY', 'private-evidence-fixture-not-a-provider-key');
    config.allowPaid = true;
    const body = decisionExample(workspaceId, 'triage');
    body.definition.question = { kind: 'json' };
    body.definition.bounded_agent = { max_model_calls: 1, max_tool_calls: 0, context_artifacts: [] };
    const accepted = await transaction(account.p.organizationId, (tx) =>
      admitInference(tx, caller, body, 'bounded_agent'),
    );
    for (let step = 0; step < 4; step++)
      if ((await advanceInference(account.p.organizationId, accepted.run_id)).done) break;
    const saved = await transaction(account.p.organizationId, async (tx) => ({
      run: await getRun(tx, accepted.run_id),
      call: (
        await tx.query<{ state: string; response_ciphertext: string; provider_completed_at: Date | null }>(
          'SELECT state,response_ciphertext,provider_completed_at FROM decision_invocations WHERE run_id=$1',
          [accepted.run_id],
        )
      ).rows[0],
      usage: (
        await tx.query('SELECT input_tokens,output_tokens,completeness FROM model_usage WHERE run_id=$1', [
          accepted.run_id,
        ])
      ).rows,
    }));
    expect(saved.run.status).toBe('failed');
    expect(saved.run.result.inference?.outcome).toBe('failed');
    expect(saved.call.state).toBe('responded');
    expect(saved.call.provider_completed_at).toBeInstanceOf(Date);
    const response = unseal<StoredDecisionResponse>(saved.call.response_ciphertext);
    expect(response.httpStatus).toBe(200);
    expect(response.providerResponse).toEqual(raw);
    expect(response.failure_code).toBe(
      failure === 'answer' ? 'invalid_provider_response' : 'invalid_provider_usage',
    );
    expect(saved.usage).toEqual(
      failure === 'answer'
        ? [{ input_tokens: '17', output_tokens: '3', completeness: 'complete' }]
        : [{ input_tokens: null, output_tokens: '0', completeness: 'missing' }],
    );
    expect(saved.run.result.inference?.billing.provisional).toBe(failure === 'usage');
    expect(saved.run.result.inference?.usage.output_tokens).toBe(failure === 'usage' ? '0' : '3');
    expect(transport).toHaveBeenCalledOnce();
    await advanceInference(account.p.organizationId, accepted.run_id);
    expect(transport).toHaveBeenCalledOnce();
  },
);

it.each([
  { condition: 'invalid JSON', text: 'not JSON', stop: 'end_turn', outcome: 'invalid_output' },
  {
    condition: 'truncated output',
    text: '{"action":"finish","value":null}',
    stop: 'max_tokens',
    outcome: 'invalid_output',
  },
  {
    condition: 'JSON null',
    text: '{"action":"finish","value":null}',
    stop: 'end_turn',
    outcome: 'value',
  },
] as const)('handles $condition with an unrestricted JSON schema without losing billing', async (test) => {
  const transport = vi.fn(async () =>
    Response.json({
      content: [{ type: 'text', text: test.text }],
      stop_reason: test.stop,
      usage: { input_tokens: 17, output_tokens: 3 },
    }),
  );
  vi.stubGlobal('fetch', transport);
  vi.stubEnv('ANTHROPIC_API_KEY', 'private-evidence-fixture-not-a-provider-key');
  config.allowPaid = true;
  const body = decisionExample(workspaceId, 'triage');
  body.definition.question = { kind: 'json' };
  body.definition.output_schema = {};
  delete body.definition.unknown_values;
  body.definition.bounded_agent = { max_model_calls: 1, max_tool_calls: 0, context_artifacts: [] };
  const accepted = await transaction(account.p.organizationId, (tx) =>
    admitInference(tx, caller, body, 'bounded_agent'),
  );
  for (let step = 0; step < 4; step++)
    if ((await advanceInference(account.p.organizationId, accepted.run_id)).done) break;
  const run = await transaction(account.p.organizationId, (tx) => getRun(tx, accepted.run_id));
  const receipt = run.result.inference;
  expect(run.status).toBe(test.outcome === 'value' ? 'succeeded' : 'failed');
  expect(receipt?.outcome).toBe(test.outcome);
  if (test.outcome === 'value') expect(receipt).toHaveProperty('value', null);
  else expect(receipt).not.toHaveProperty('value');
  expect(receipt?.usage).toMatchObject({
    input_tokens: '17',
    output_tokens: '3',
    completeness: 'complete',
  });
  expect(BigInt(receipt?.billing.charged_micro_usd ?? '0')).toBeGreaterThan(0n);
  expect(transport).toHaveBeenCalledOnce();
});
