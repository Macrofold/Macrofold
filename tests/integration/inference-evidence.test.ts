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
import { fixtureHttpApi } from '../fixtures/http-api';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let workspaceId: string;
let caller: Awaited<ReturnType<typeof fixtureAccount>>['p'];
let apiKey: string;
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
    apiKey = key.secret;
  });
});

it('serves authorized HTTP status, lists and replay metadata independently of canonical result content', async () => {
  const httpFetch = globalThis.fetch;
  const provider = vi.fn(async () =>
    Response.json({
      content: [{ type: 'text', text: '{"action":"finish","value":"wait"}' }],
      usage: { input_tokens: 17, output_tokens: 3 },
    }),
  );
  vi.stubGlobal('fetch', provider);
  vi.stubEnv('ANTHROPIC_API_KEY', 'summary-fixture-not-a-provider-key');
  config.allowPaid = true;
  const body = decisionExample(workspaceId, 'triage');
  body.definition.question = { kind: 'json' };
  body.definition.bounded_agent = { max_model_calls: 1, max_tool_calls: 0, context_artifacts: [] };
  const accepted = await transaction(account.p.organizationId, (tx) =>
    admitInference(tx, caller, body, 'bounded_agent'),
  );
  expect(await advanceInference(account.p.organizationId, accepted.run_id)).toMatchObject({ done: true });
  const server = await fixtureHttpApi();
  const request = (path: string, credential = apiKey) =>
    httpFetch(server.origin + path, { headers: { Authorization: 'Bearer ' + credential } });
  const runPath = `/v1/runs/${accepted.run_id}`;
  try {
    const statusResponse = await request(runPath);
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json();
    expect(status).toMatchObject({
      id: accepted.run_id,
      organization_id: account.p.organizationId,
      workspace_id: workspaceId,
      kind: 'bounded_agent',
      model: body.model_binding.model,
      status: 'succeeded',
      harness: null,
      worktree_id: null,
      session_id: null,
      waiting_reason: null,
      execution_outcome: 'success',
      persistence_status: 'not_required',
      reserved_micro_usd: '0',
      created_at: expect.any(String),
      completed_at: expect.any(String),
    });
    for (const privateField of ['config', 'result', 'inference', 'input', 'context'])
      expect(status).not.toHaveProperty(privateField);
    const complete = await request(runPath + '/result');
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({
      run_id: accepted.run_id,
      final: true,
      inference: { outcome: 'value', value: 'wait' },
    });
    // Model a damaged content owner. Lifecycle/control reads still work; only
    // a caller explicitly asking for the answer may encounter this integrity error.
    await transaction(account.p.organizationId, (tx) =>
      tx.query("UPDATE decision_invocations SET response_ciphertext='' WHERE run_id=$1", [accepted.run_id]),
    );
    const summary = await request(runPath);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toEqual(status);
    const list = await request(`/v1/runs?workspace_id=${workspaceId}`);
    expect(list.status).toBe(200);
    expect((await list.json()).data).toContainEqual(status);
    const events = await request(runPath + '/events');
    expect(events.status).toBe(200);
    expect((await events.json()).data).toContainEqual(expect.objectContaining({ type: 'run.succeeded' }));
    const artifacts = await request(runPath + '/artifacts');
    expect(artifacts.status).toBe(200);
    expect((await artifacts.json()).data).toEqual([]);
    const stream = await request(runPath + '/stream');
    expect(stream.status).toBe(200);
    expect(await stream.text()).toContain('run.succeeded');
    const missing = await request(runPath + '/result');
    expect(missing.status).toBe(500);
    expect(await missing.json()).toMatchObject({ error: { code: 'inference_output_missing' } });

    const neighbor = await fixtureAccount('Summary neighboring tenant');
    const keys = await transaction(account.p.organizationId, async (tx) => {
      const otherWorkspace = await resources.create(tx, 'workspaces', account.p.organizationId, {
        name: 'Other summary access',
      });
      return {
        workspace: await createKey(tx, account.p, {
          name: 'Other workspace only',
          workspace_id: otherWorkspace.id,
          scopes: ['runs:read', 'files:read'],
        }),
        scope: await createKey(tx, account.p, {
          name: 'Files only',
          workspace_id: workspaceId,
          scopes: ['files:read'],
        }),
      };
    });
    for (const path of [runPath, runPath + '/events', runPath + '/stream', runPath + '/result']) {
      expect((await request(path, neighbor.key)).status).toBe(404);
      expect((await request(path, keys.workspace.secret)).status).toBe(404);
      expect((await request(path, keys.scope.secret)).status).toBe(403);
    }
    const restrictedList = await request(`/v1/runs?workspace_id=${workspaceId}`, keys.workspace.secret);
    expect(restrictedList.status).toBe(200);
    expect((await restrictedList.json()).data).toEqual([]);
    expect(provider).toHaveBeenCalledOnce();
  } finally {
    await server.close();
  }
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
