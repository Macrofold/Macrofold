import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fixtureHttpApi } from '../fixtures/http-api';
import { Client } from '../../sdk/typescript/src/index';
import { auth, customerScopes, type Principal } from '../../packages/core/src/auth';
import { config } from '../../packages/core/src/config';
import { authPool, pool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import { credit } from '../../packages/core/src/ledger';
import { createKey } from '../../packages/core/src/keys';
import { saveConnection } from '../../packages/core/src/connections';
import * as resources from '../../packages/core/src/resources';
import { handleApi } from '../../packages/core/src/http';
import { advanceInference } from '../../packages/core/src/inference-engine';
import { advanceTask } from '../../packages/core/src/decision-task-engine';
import { getRun, cancelRun } from '../../packages/core/src/runs';
import type { InferenceCreate } from '../../packages/core/src/decision';
import type { ResolvedInferenceCreate } from '../../packages/core/src/inferences';
import * as tracing from '../../packages/core/src/tracing';

let owner: Principal, application: Principal, workspaceId: string, key: string;
const originalPaid = config.allowPaid;
beforeAll(async () => {
  const user = (
    await auth.api.signUpEmail({
      body: {
        email: `inference-${id()}@example.test`,
        name: 'Inference fixture',
        password: 'synthetic-fixture-password',
      },
    })
  ).user;
  await pool.query('UPDATE auth."user" SET "emailVerified"=true WHERE id=$1', [user.id]);
  const org = (await pool.query('SELECT organization_id FROM memberships WHERE user_id=$1', [user.id]))
    .rows[0].organization_id;
  owner = {
    id: user.id,
    userId: user.id,
    organizationId: org,
    role: 'owner',
    kind: 'user',
    scopes: customerScopes,
    workspaceIds: [],
    operator: false,
  };
  await transaction(org, async (tx) => {
    await credit(tx, org, 100_000_000n, `fixture:${id()}`);
    workspaceId = (await resources.create(tx, 'workspaces', org, { name: 'Decision fixture' })).id;
    const issued = await createKey(tx, owner, {
      name: 'App fixture',
      workspace_id: workspaceId,
      scopes: ['runs:read', 'runs:write', 'files:read', 'files:write'],
    });
    key = issued.secret;
    application = {
      ...owner,
      id: issued.id,
      kind: 'api_key',
      workspaceIds: [workspaceId],
      scopes: issued.scopes,
    };
  });
});
afterEach(async () => {
  try {
    // Retire only this suite's admitted work. Leftover interactive jobs must not
    // compete with another suite's scheduler turns in the shared disposable DB.
    if (owner) {
      const active = await transaction(owner.organizationId, (tx) =>
        tx.query<{ id: string }>("SELECT id FROM runs WHERE status IN ('queued','provisioning','running')"),
      );
      for (const run of active.rows) {
        await transaction(owner.organizationId, (tx) => cancelRun(tx, owner, run.id));
        await advanceInference(owner.organizationId, run.id);
      }
    }
  } finally {
    config.allowPaid = originalPaid;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
function input(): ResolvedInferenceCreate {
  return {
    workspace_id: workspaceId,
    input: { case_id: 'case-1' },
    definition: {
      revision: 'triage/1',
      prompt: 'Choose review or ignore.',
      input_schema: {
        type: 'object',
        required: ['case_id'],
        properties: { case_id: { type: 'string' } },
        additionalProperties: false,
      },
      output_schema: { type: 'string', enum: ['review', 'ignore'] },
      question: { kind: 'choice', criteria: { review: 'Needs investigation', ignore: 'No change' } },
      allowed_models: [{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }],
      limits: { max_cost_micro_usd: '50000', max_output_tokens: 256, timeout_seconds: 20 },
      required_known: ['evidence'],
      require_complete: true,
      require_snapshot: true,
    },
    model_binding: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', billing_mode: 'managed' },
    context: {
      schema_version: 1,
      template_revision: 'triage-context/1',
      audience: { kind: 'application_actor', id: 'actor-1' },
      items: [
        {
          id: 'evidence',
          status: 'known',
          kind: 'observation',
          source: 'app:case',
          source_revision: '7',
          observed_at: new Date().toISOString(),
          value: { overdue: true },
        },
      ],
      complete: true,
      truncated: false,
      consistency: 'snapshot',
      observed_at: new Date().toISOString(),
      dependency_tokens: { query: 'collection-19' },
    },
  };
}
function enable() {
  config.allowPaid = true;
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-inference-key');
}
it.each(['admission', 'spending'] as const)('preserves the explicit %s pause without admitting a run', async (pause) => {
  enable();
  if (pause === 'admission') vi.stubEnv('RUN_ADMISSION_ENABLED', 'false');
  else config.allowPaid = false;
  const countRuns = () => transaction(owner.organizationId, async (tx) =>
    (await tx.query('SELECT count(*)::integer AS count FROM runs')).rows[0].count,
  );
  const before = await countRuns();
  const response = await api('inferences', 'POST', input());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: pause === 'admission' ? 'inference_disabled' : 'execution_disabled' } });
  expect(await countRuns()).toBe(before);
});
async function api(path: string, method = 'GET', body?: unknown, identity = id()) {
  return handleApi(
    new Request(`${config.origin}/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        'idempotency-key': identity,
        prefer: 'respond-async',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
async function submit(body: InferenceCreate = input()) {
  enable();
  const response = await api('inferences', 'POST', body);
  const result = await response.json();
  expect(result, JSON.stringify(result)).toHaveProperty('run_id');
  expect(response.status).toBe(202);
  return result.run_id as string;
}
function provider(value: unknown = 'review', withUsage = true) {
  const fetch = vi.fn(async () =>
    Response.json(
      {
        type: 'message',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: JSON.stringify(value) }],
        ...(withUsage ? { usage: { input_tokens: 100, output_tokens: 10 } } : {}),
      },
      { headers: { 'request-id': 'provider-fixture' } },
    ),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
async function complete(runId: string) {
  for (let step = 0; step < 8; step++) if ((await advanceInference(owner.organizationId, runId)).done) return;
  throw new Error('Inference did not finish');
}
it('performs one typed request with no worktree/session and shares result/events/ledger', async () => {
  const call = provider();
  const runId = await submit();
  await complete(runId);
  expect(call).toHaveBeenCalledTimes(1);
  const result = await (await api(`runs/${runId}/result`)).json();
  expect(result).toMatchObject({
    final: true,
    execution_outcome: 'success',
    persistence_status: 'not_required',
    inference: {
      outcome: 'value',
      value: 'review',
      validation: { status: 'passed' },
      dependency_tokens: { query: 'collection-19' },
    },
  });
  const run = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
  expect(run).toMatchObject({
    kind: 'inference',
    worktree_id: null,
    session_id: null,
    execution_binding: null,
    cost_micro_usd: '150',
  });
  expect(result.inference.provider_request_digest).not.toBe(result.inference.context_digest);
  const events = await (await api(`runs/${runId}/events`)).json();
  expect(JSON.stringify(events)).toContain('run.succeeded');
  await complete(runId);
  expect(call).toHaveBeenCalledTimes(1);
});
it('traces explicit decision context, billing, actor and final receipt under one run identity', async () => {
  const trace = vi.spyOn(tracing,'recordTrace').mockImplementation(() => {});
  vi.spyOn(tracing,'tracingEnabled').mockReturnValue(true);
  provider();
  const runId = await submit();
  await complete(runId);
  const observations = trace.mock.calls.map(([o])=>o);
  // Successful output belongs to the settled generation, not a duplicate raw-response event.
  expect(observations.filter(o=>o.type==='generation')).toHaveLength(1);
  const generation = observations.find(o=>o.type==='generation')!;
  expect(generation).toMatchObject({name:'decision.generate',chargedMicroUsd:'150',context:{run_id:runId,workspace_id:workspaceId,worktree_id:null,actor_id:'actor-1',definition_revision:'triage/1'},metadata:{provider_request_id:'provider-fixture',provisional:false,provider_cost_status:'estimated_from_usage'}});
  expect(JSON.stringify(generation.input)).toContain('overdue');
  expect(generation.output).toMatchObject({value:'review'});
  expect(observations.find(o=>o.id==='run')).toMatchObject({type:'agent',metadata:{status:'succeeded',charged_micro_usd:'150'},output:{inference:{value:'review'}}});
  expect(observations.every(o=>o.context.run_id===runId)).toBe(true);
});
it('deduplicates concurrent admission and rejects changed-body replay', async () => {
  enable();
  const body = input(),
    identity = id();
  const responses = await Promise.all([
    api('inferences', 'POST', body, identity),
    api('inferences', 'POST', body, identity),
  ]);
  const values = await Promise.all(responses.map((r) => r.json()));
  expect(values[0].run_id).toBe(values[1].run_id);
  expect((await api('inferences', 'POST', { ...body, input: { case_id: 'changed' } }, identity)).status).toBe(
    409,
  );
  await api(`runs/${values[0].run_id}/cancel`, 'POST', {});
});
it('rejects unknown required evidence and expanded ceilings before reserving', async () => {
  enable();
  const body = input();
  body.context.items[0].status = 'unknown';
  expect((await api('inferences', 'POST', body)).status).toBe(400);
  const expanded = input();
  expanded.limits = { ...expanded.definition.limits, max_output_tokens: 257 };
  expect((await api('inferences', 'POST', expanded)).status).toBe(400);
  const foreign = input();
  foreign.workspace_id = id();
  expect((await api('inferences', 'POST', foreign)).status).toBe(404);
});
it('never labels an out-of-schema response a value', async () => {
  provider('unauthorized-effect');
  const runId = await submit();
  await complete(runId);
  const result = await (await api(`runs/${runId}/result`)).json();
  expect(result.inference).toMatchObject({ outcome: 'invalid_output', validation: { status: 'failed' } });
  expect(result.inference).not.toHaveProperty('value');
});
it.each(
  (['typesafe', 'openrouter'] as const).flatMap((provider) =>
    [
      ['choice', 'review', 'value'],
      ['choice', 'unlisted', 'invalid_output'],
      ['score', 1.5, 'value'],
      ['score', 3, 'invalid_output'],
    ].map(([kind, value, outcome]) => ({ provider, kind, value, outcome })),
  ),
)('settles $provider Jev $kind response $value as $outcome', async ({ provider, kind, value, outcome }) => {
  enable();
  vi.stubEnv(`${provider.toUpperCase()}_API_KEY`, 'synthetic-jev-key');
  const model = provider === 'openrouter' ? 'typesafe/jev-1.13' : 'jev-1.13.0';
  const endpoint =
    provider === 'openrouter'
      ? 'https://openrouter.ai/api/alpha/decisions'
      : 'https://api.typesafe.ai/v1/systemone';
  const body = input();
  body.model_binding = { provider, model, billing_mode: 'managed' };
  body.definition.allowed_models = [{ provider, model }];
  body.definition.output_schema = { type: kind === 'choice' ? 'string' : 'number' };
  if (kind === 'score') body.definition.question = { kind: 'score', criteria: ['Low', 'Medium', 'High'] };
  const call = vi.fn(async () =>
    Response.json(
      {
        model,
        ...(provider === 'openrouter' ? { id: 'jev-fixture' } : {}),
        answers: { decision: { type: kind, [kind]: value, confidence: 0.8 } },
        usage: { input_tokens: 1000, output_tokens: 0 },
      },
      { headers: { 'x-request-id': 'jev-fixture' } },
    ),
  );
  vi.stubGlobal('fetch', call);
  const runId = await submit(body);
  await complete(runId);
  const run = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
  expect(run.cost_micro_usd).toBe('42');
  expect(run.result.inference).toMatchObject({
    outcome,
    model_revision: model,
    transformation_version: provider === 'openrouter' ? 'openrouter-decisions/1' : 'typesafe-systemone/1',
    provider_request_id: 'jev-fixture',
  });
  const recorded = await transaction(owner.organizationId, (tx) =>
    tx.query('SELECT provider FROM gateway_requests WHERE run_id=$1', [runId]),
  );
  expect(recorded.rows[0].provider).toBe(provider);
  if (outcome === 'value') expect(run.result.inference?.value).toBe(value);
  else expect(run.result.inference).not.toHaveProperty('value');
  expect(call).toHaveBeenCalledExactlyOnceWith(
    endpoint,
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer synthetic-jev-key' }),
    }),
  );
});
it.each([
  ['typesafe', 'typed'], ['typesafe', 'native'],
  ['openrouter', 'typed'], ['openrouter', 'native'],
] as const)('dispatches %s %s Jev requests larger in bytes than the token window', async (provider, shape) => {
  vi.stubEnv(`${provider.toUpperCase()}_API_KEY`, 'synthetic-jev-key');
  const model = provider === 'openrouter' ? 'typesafe/jev-1.13' : 'jev-1.13.0';
  const body = input();
  body.model_binding = { provider, model, billing_mode: 'managed' };
  body.definition.allowed_models = [{ provider, model }];
  const text = ' hello'.repeat(6000); // 36KB, not 36K tokens.
  body.context.items[0].value = text;
  const nativeInput = {
    state: text,
    questions: { decision: { type: 'choice', instructions: 'Choose review.', criteria: { review: 'Review' } } },
  };
  const call = vi.fn(async () => Response.json({
    model, answers: { decision: { type: 'choice', choice: 'review' } },
    usage: { input_tokens: 6314, output_tokens: 31 },
  }));
  vi.stubGlobal('fetch', call);
  const runId = await submit(shape === 'typed' ? body : {
    workspace_id: workspaceId, model_binding: body.model_binding,
    input: nativeInput, limits: body.definition.limits,
  });
  await complete(runId);
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
    body: expect.stringContaining(text),
  }));
  const run = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
  expect(run.status).toBe('succeeded');
  expect(run.result.inference?.outcome).toBe('value');
  expect(run.cost_micro_usd).toBe('266'); // Actual reported input usage at $0.042/M.
});

it.each(['success', 'budget', 'provider-rejection'] as const)(
  'keeps billing and provider authority separate from conventional context estimation: %s', async (outcome) => {
    const body = input();
    body.context.items[0].value = ' hello'.repeat(22000); // Exceeds the former 128KB pseudo-token window.
    body.definition.limits.max_cost_micro_usd = outcome === 'budget' ? '1' : '500000';
    const call = outcome === 'provider-rejection'
      ? vi.fn(async () => Response.json({ error: { type: 'invalid_request_error', message: 'Prompt is too long' } }, { status: 400 }))
      : provider();
    vi.stubGlobal('fetch', call);
    const runId = await submit(body);
    await complete(runId);
    const run = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
    if (outcome === 'budget') {
      expect(call).not.toHaveBeenCalled();
      expect(run.result.failure_code).toBe('run_budget_exhausted');
      expect(run.cost_micro_usd).toBe('0');
    } else if (outcome === 'provider-rejection') {
      expect(run.status).toBe('failed');
      expect(run.result.inference?.outcome).toBe('uncertain');
      await advanceInference(owner.organizationId, runId);
      expect(call).toHaveBeenCalledTimes(1); // No blind retry after dispatch.
    } else {
      expect(call).toHaveBeenCalledTimes(1);
      expect(run.status).toBe('succeeded');
      expect(run.cost_micro_usd).toBe('150');
    }
  },
);

it('uses the exact OpenRouter BYOK connection and rechecks revocation without managed fallback', async () => {
  enable();
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-managed-key');
  const connection = await transaction(owner.organizationId, (tx) =>
    saveConnection(tx, owner, {
      name: 'OpenRouter fixture',
      kind: 'model',
      provider: 'openrouter',
      auth_method: 'api_key',
      secret: 'synthetic-byok-key',
    }),
  );
  const body = input();
  body.model_binding = {
    provider: 'openrouter',
    model: 'typesafe/jev-1.13',
    billing_mode: 'byok',
    provider_connection_id: connection.id,
  };
  body.definition.allowed_models = [{ provider: 'openrouter', model: body.model_binding.model }];
  const call = vi.fn(async () =>
    Response.json({
      id: 'byok-generation',
      answers: { decision: { type: 'choice', choice: 'review' } },
      usage: { input_tokens: 1000, output_tokens: 0 },
    }),
  );
  vi.stubGlobal('fetch', call);
  const runId = await submit(body);
  await complete(runId);
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'https://openrouter.ai/api/alpha/decisions',
    expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer synthetic-byok-key' }),
    }),
  );
  const run = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
  expect(run.cost_micro_usd).toBe('0');
  const budget = await transaction(owner.organizationId, (tx) =>
    tx.query<{ budget_used_micro_usd: string }>('SELECT budget_used_micro_usd FROM runs WHERE id=$1', [runId]),
  );
  expect(budget.rows[0].budget_used_micro_usd).toBe('42');
  expect(run.result.inference).toMatchObject({ outcome: 'value', value: 'review' });
  const revoked = await submit(body);
  await advanceInference(owner.organizationId, revoked);
  await transaction(owner.organizationId, (tx) =>
    resources.update(tx, 'connections', connection.id, { status: 'error' }),
  );
  await complete(revoked);
  expect(call).toHaveBeenCalledTimes(1);
  expect(await transaction(owner.organizationId, (tx) => getRun(tx, revoked))).toMatchObject({
    status: 'failed',
    cost_micro_usd: '0',
  });
  expect((await api('inferences', 'POST', body)).status).toBe(403);
});
it('rejects missing or wrong-provider OpenRouter credentials before dispatch', async () => {
  enable();
  vi.stubEnv('OPENROUTER_API_KEY', '');
  vi.stubEnv('TYPESAFE_API_KEY', 'synthetic-other-provider-key');
  const call = provider();
  const body = input();
  body.model_binding = { provider: 'openrouter', model: 'typesafe/jev-1.13', billing_mode: 'managed' };
  body.definition.allowed_models = [{ provider: 'openrouter', model: body.model_binding.model }];
  const missing = await api('inferences', 'POST', body);
  expect(missing.status).toBe(503);
  const connection = await transaction(owner.organizationId, (tx) =>
    saveConnection(tx, owner, {
      name: 'Wrong provider',
      kind: 'model',
      provider: 'typesafe',
      auth_method: 'api_key',
      secret: 'synthetic-other-provider-key',
    }),
  );
  body.model_binding.billing_mode = 'byok';
  body.model_binding.provider_connection_id = connection.id;
  expect((await api('inferences', 'POST', body)).status).toBe(403);
  expect(call).not.toHaveBeenCalled();
});
it('keeps missing usage provisional and consumes the bound instead of zero', async () => {
  provider('review', false);
  const runId = await submit();
  await complete(runId);
  const result = await transaction(owner.organizationId, (tx) =>
    tx.query('SELECT completeness,cost_micro_usd,usage_details FROM model_usage WHERE run_id=$1', [runId]),
  );
  expect(result.rows[0].completeness).toBe('missing');
  expect(BigInt(result.rows[0].cost_micro_usd)).toBeGreaterThan(0n);
  expect(result.rows[0].usage_details.provisional).toBe(true);
});
it('fences ambiguous dispatch without replay and accounts for cancellation', async () => {
  const call = provider();
  const runId = await submit();
  await advanceInference(owner.organizationId, runId);
  await transaction(owner.organizationId, async (tx) => {
    await tx.query(
      "UPDATE decision_invocations SET state='dispatch_started',dispatch_started_at=now() WHERE run_id=$1",
      [runId],
    );
    await tx.query("UPDATE runs SET deadline=now()-interval '1 second' WHERE id=$1", [runId]);
  });
  await complete(runId);
  expect(call).not.toHaveBeenCalled();
  const run = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
  expect(run.status).toBe('timed_out');
  expect(run.result.inference?.outcome).toBe('uncertain');
  expect(BigInt(run.cost_micro_usd)).toBeGreaterThan(0n);
});
it('rechecks initiating key revocation before billable dispatch', async () => {
  const call = provider();
  const runId = await submit();
  await advanceInference(owner.organizationId, runId);
  await transaction(owner.organizationId, (tx) =>
    tx.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [application.id]),
  );
  try {
    await complete(runId);
    expect(call).not.toHaveBeenCalled();
    const run = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
    expect(run.status).toBe('failed');
    expect(run.cost_micro_usd).toBe('0');
  } finally {
    await transaction(owner.organizationId, (tx) =>
      tx.query('UPDATE api_keys SET revoked_at=NULL WHERE id=$1', [application.id]),
    );
  }
});

it('pins named definitions and immutable evidence; rejects an audience substitution', async () => {
  enable();
  const body = input();
  const definition = await (
    await api('decision-definitions', 'POST', {
      workspace_id: workspaceId,
      name: 'Triage',
      definition: body.definition,
    })
  ).json();
  const snapshot = await (
    await api('context-artifacts', 'POST', {
      workspace_id: workspaceId,
      name: 'Case evidence',
      context: body.context,
    })
  ).json();
  expect(snapshot).toHaveProperty('sha256');
  const request: InferenceCreate = {
    ...body,
    definition: { definition_id: definition.id, revision: body.definition.revision },
    context: { artifact_id: snapshot.id, revision: snapshot.revision, audience: body.context.audience },
  };
  provider();
  const runId = await submit(request);
  await complete(runId);
  expect((await (await api(`runs/${runId}/result`)).json()).inference.value).toBe('review');
  expect(
    (
      await api('inferences', 'POST', {
        ...request,
        context: { ...request.context, audience: { kind: 'application_actor', id: 'someone-else' } },
      })
    ).status,
  ).toBe(403);
  expect((await api('context-artifacts/' + snapshot.id, 'DELETE')).status).toBe(200);
  expect((await api('inferences', 'POST', request)).status).toBe(404);
});

it('inspects granted evidence through a finite loop and rejects ungranted reads', async () => {
  enable();
  const body = input();
  const snapshot = await (
    await api('context-artifacts', 'POST', {
      workspace_id: workspaceId,
      name: 'Bounded evidence',
      context: body.context,
    })
  ).json();
  body.definition.question = { kind: 'json' };
  body.definition.bounded_agent = {
    max_model_calls: 3,
    max_tool_calls: 1,
    context_artifacts: [
      { artifact_id: snapshot.id, revision: snapshot.revision, audience: body.context.audience },
    ],
  };
  const call = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        model: body.model_binding.model,
        content: [
          { type: 'text', text: JSON.stringify({ action: 'read_context', artifact_id: snapshot.id }) },
        ],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        model: body.model_binding.model,
        content: [{ type: 'text', text: JSON.stringify({ action: 'finish', value: 'review' }) }],
        usage: { input_tokens: 100, output_tokens: 10 },
      }),
    );
  vi.stubGlobal('fetch', call);
  const accepted = await (await api('bounded-agent-runs', 'POST', body)).json();
  expect(accepted).toHaveProperty('run_id');
  await complete(accepted.run_id);
  const result = await (await api(`runs/${accepted.run_id}/result`)).json();
  expect(result.inference).toMatchObject({ outcome: 'value', value: 'review' });
  expect(call).toHaveBeenCalledTimes(2);
  expect(JSON.parse(call.mock.calls[1][1].body).messages[0].content).toContain(snapshot.id);
  expect(
    (
      await transaction(owner.organizationId, (tx) =>
        tx.query('SELECT * FROM decision_tool_steps WHERE run_id=$1', [accepted.run_id]),
      )
    ).rowCount,
  ).toBe(1);
  provider({ action: 'read_context', artifact_id: id() });
  const denied = await (await api('bounded-agent-runs', 'POST', body)).json();
  await complete(denied.run_id);
  expect((await (await api(`runs/${denied.run_id}`)).json()).failure_code).toBe('tool_not_granted');
});

it('coordinates duplicate-safe task wakes, one conditional child and application rejection', async () => {
  enable();
  const body = input(),
    investigation = structuredClone(body.definition);
  investigation.question = { kind: 'json' };
  investigation.bounded_agent = { max_model_calls: 1, max_tool_calls: 0, context_artifacts: [] };
  const created = await api('tasks', 'POST', {
    workspace_id: workspaceId,
    objective: 'Review a customer exception',
    decide: { definition: body.definition, model_binding: body.model_binding },
    investigate: { definition: investigation, model_binding: body.model_binding },
    investigate_when: 'review',
    max_cost_micro_usd: '100000',
    max_runs: 4,
    evidence_horizon_seconds: 3600,
  });
  const task = await created.json();
  expect(task, JSON.stringify(task)).toMatchObject({ status: 'waiting', outstanding_micro_usd: '0' });
  const wake = { event_id: 'case-revision-7', input: body.input, context: body.context };
  const admitted = await Promise.all([
    api(`tasks/${task.id}/wake`, 'POST', wake),
    api(`tasks/${task.id}/wake`, 'POST', wake),
  ]);
  const receipts = await Promise.all(admitted.map((response) => response.json()));
  expect(receipts[0].runs).toHaveLength(1);
  expect(receipts[0].runs[0].run_id).toBe(receipts[1].runs[0].run_id);
  provider('review');
  await complete(receipts[0].runs[0].run_id);
  await advanceTask(owner.organizationId, task.id);
  const investigating = await (await api(`tasks/${task.id}`)).json();
  expect(investigating.runs).toHaveLength(2);
  expect(investigating.outstanding_micro_usd).toBe('50000');
  provider({ action: 'finish', value: 'review' });
  await complete(investigating.runs[1].run_id);
  await advanceTask(owner.organizationId, task.id);
  const proposal = await (await api(`tasks/${task.id}`)).json();
  expect(proposal).toMatchObject({
    status: 'proposal',
    outstanding_micro_usd: '0',
    committed_micro_usd: '300',
  });
  expect(proposal.proposal_artifact_id).toBeTruthy();
  const rejected = await (
    await api(`tasks/${task.id}/outcomes`, 'POST', {
      event_id: 'review-7',
      wake_id: proposal.latest_wake_id,
      outcome: 'rejected',
      evidence: { reason: 'Case changed since observation' },
    })
  ).json();
  expect(rejected.status).toBe('waiting');
  expect(rejected.outcomes[0].receipt.outcome).toBe('rejected');
  expect((await (await api(`runs/${investigating.runs[1].run_id}/result`)).json()).inference.outcome).toBe(
    'value',
  );
  expect(
    (await api(`tasks/${task.id}/wake`, 'POST', { ...wake, input: { case_id: 'changed' } })).status,
  ).toBe(409);
  await api(`tasks/${task.id}/close`, 'POST');
  await advanceTask(owner.organizationId, task.id);
  expect((await (await api(`tasks/${task.id}`)).json()).status).toBe('closed');
});

it('permits a task mutation receipt with runs:write while denying separate reads', async () => {
  const issued = await transaction(owner.organizationId, (tx) =>
    createKey(tx, owner, {
      name: 'Task writer',
      workspace_id: workspaceId,
      scopes: ['runs:write'],
    }),
  );
  const request = (path: string, method: string, body?: unknown) =>
    handleApi(
      new Request(`${config.origin}/v1/${path}`, {
        method,
        headers: {
          authorization: `Bearer ${issued.secret}`,
          'content-type': 'application/json',
          'idempotency-key': id(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const body = input();
  const created = await request('tasks', 'POST', {
    workspace_id: workspaceId,
    objective: 'Write-only task submission',
    decide: { definition: body.definition, model_binding: body.model_binding },
    max_cost_micro_usd: '50000',
    max_runs: 1,
    evidence_horizon_seconds: 3600,
  });
  expect(created.status).toBe(200);
  const task = await created.json();
  expect(task).toMatchObject({ status: 'waiting', outstanding_micro_usd: '0' });
  expect((await request(`tasks/${task.id}`, 'GET')).status).toBe(403);
  expect((await request(`tasks/${task.id}/close`, 'POST')).status).toBe(200);
});

it('replays a committed wake after its independently published evidence is released', async () => {
  enable();
  const body = input();
  const snapshot = await (
    await api('context-artifacts', 'POST', {
      workspace_id: workspaceId,
      name: 'Wake evidence',
      context: body.context,
    })
  ).json();
  const task = await (
    await api('tasks', 'POST', {
      workspace_id: workspaceId,
      objective: 'Review once',
      decide: { definition: body.definition, model_binding: body.model_binding },
      max_cost_micro_usd: '100000',
      max_runs: 2,
      evidence_horizon_seconds: 3600,
    })
  ).json();
  const wake = {
    event_id: 'retained-receipt',
    input: body.input,
    context: { artifact_id: snapshot.id, revision: snapshot.revision, audience: body.context.audience },
  };
  const active = await (await api(`tasks/${task.id}/wake`, 'POST', wake)).json();
  expect((await api(`artifacts/${snapshot.id}`, 'DELETE')).status).toBe(409);
  const call = provider();
  await complete(active.runs[0].run_id);
  await advanceTask(owner.organizationId, task.id);
  const outcome = { event_id: 'review', wake_id: active.latest_wake_id, outcome: 'accepted', evidence: {} };
  expect((await api(`tasks/${task.id}/outcomes`, 'POST', outcome)).status).toBe(200);
  expect((await api(`artifacts/${snapshot.id}`, 'DELETE')).status).toBe(204);
  const replay = await api(`tasks/${task.id}/wake`, 'POST', wake);
  expect(replay.status).toBe(200);
  expect((await replay.json()).runs).toEqual(
    expect.arrayContaining([expect.objectContaining({ run_id: active.runs[0].run_id })]),
  );
  const reviewed = await (await api(`tasks/${task.id}/outcomes`, 'POST', outcome)).json();
  expect(reviewed.runs).toHaveLength(1);
  expect(reviewed.outcomes).toHaveLength(1);
  expect(reviewed.committed_micro_usd).toBe('150');
  expect(reviewed.outstanding_micro_usd).toBe('0');
  expect(call).toHaveBeenCalledTimes(1);
  expect(
    (await api(`tasks/${task.id}/wake`, 'POST', { ...wake, input: { case_id: 'different' } })).status,
  ).toBe(409);
});

it.each(['run_bound', 'revoked', 'invalid_output', 'horizon'] as const)(
  'stops task progression at %s without allocating another child',
  async (boundary) => {
    enable();
    const body = input(),
      investigation = structuredClone(body.definition);
    investigation.question = { kind: 'json' };
    investigation.bounded_agent = { max_model_calls: 1, max_tool_calls: 0, context_artifacts: [] };
    const task = await (
      await api('tasks', 'POST', {
        workspace_id: workspaceId,
        objective: 'Bounded review',
        decide: { definition: body.definition, model_binding: body.model_binding },
        investigate: { definition: investigation, model_binding: body.model_binding },
        investigate_when: 'review',
        max_cost_micro_usd: '100000',
        max_runs: boundary === 'run_bound' ? 1 : 4,
        evidence_horizon_seconds: 3600,
      })
    ).json();
    const active = await (
      await api(`tasks/${task.id}/wake`, 'POST', {
        event_id: 'bounded-event',
        input: body.input,
        context: body.context,
      })
    ).json();
    const call = provider(boundary === 'invalid_output' ? 'invalid-choice' : 'review');
    await complete(active.runs[0].run_id);
    try {
      if (boundary === 'revoked')
        await transaction(owner.organizationId, (tx) =>
          tx.query('UPDATE api_keys SET revoked_at=now() WHERE id=$1', [application.id]),
        );
      if (boundary === 'horizon')
        await transaction(owner.organizationId, (tx) =>
          tx.query("UPDATE decision_tasks SET evidence_expires_at=now()-interval '1 second' WHERE id=$1", [
            task.id,
          ]),
        );
      await advanceTask(owner.organizationId, task.id);
    } finally {
      if (boundary === 'revoked')
        await transaction(owner.organizationId, (tx) =>
          tx.query('UPDATE api_keys SET revoked_at=NULL WHERE id=$1', [application.id]),
        );
    }
    const stopped = await (await api(`tasks/${task.id}`)).json();
    expect(stopped).toMatchObject({
      status: boundary === 'horizon' ? 'closed' : 'stopped',
      failure_code: {
        run_bound: 'task_budget_exhausted',
        revoked: 'authorization_revoked',
        invalid_output: 'invalid_output',
        horizon: null,
      }[boundary],
      committed_micro_usd: '150',
      outstanding_micro_usd: '0',
      proposal_artifact_id: null,
    });
    expect(stopped.runs).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(
      (
        await transaction(owner.organizationId, (tx) =>
          tx.query('SELECT 1 FROM decision_task_evidence WHERE task_id=$1', [task.id]),
        )
      ).rowCount,
    ).toBe(0);
  },
);

it('keeps an active task allocation until cancellation settles the child', async () => {
  enable();
  const body = input();
  const task = await (
    await api('tasks', 'POST', {
      workspace_id: workspaceId,
      objective: 'Cancellable review',
      decide: { definition: body.definition, model_binding: body.model_binding },
      max_cost_micro_usd: '50000',
      max_runs: 1,
      evidence_horizon_seconds: 3600,
    })
  ).json();
  const active = await (
    await api(`tasks/${task.id}/wake`, 'POST', {
      event_id: 'cancel',
      input: body.input,
      context: body.context,
    })
  ).json();
  const call = provider();
  await advanceInference(owner.organizationId, active.runs[0].run_id);
  expect((await api(`tasks/${task.id}/close`, 'POST')).status).toBe(200);
  await advanceTask(owner.organizationId, task.id);
  expect(await (await api(`tasks/${task.id}`)).json()).toMatchObject({
    status: 'running',
    outstanding_micro_usd: '50000',
  });
  await complete(active.runs[0].run_id);
  await advanceTask(owner.organizationId, task.id);
  expect(await (await api(`tasks/${task.id}`)).json()).toMatchObject({
    status: 'closed',
    outstanding_micro_usd: '0',
    committed_micro_usd: '0',
  });
  expect(call).not.toHaveBeenCalled();
});

async function killAt(runId: string, boundary: 'dispatch' | 'receipt') {
  const child = fork('tests/fixtures/inference-worker.ts', [owner.organizationId, runId, boundary], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, ANTHROPIC_API_KEY: 'synthetic-inference-key' },
  });
  try {
    const [phase] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
    expect(phase).toBe(boundary);
  } finally {
    const stopped = once(child, 'exit');
    child.kill('SIGKILL');
    await stopped;
  }
}
it.each(['dispatch', 'receipt'] as const)(
  'recovers a real process kill after %s without repeating a provider call',
  async (boundary) => {
    const call = provider(),
      runId = await submit();
    await advanceInference(owner.organizationId, runId);
    await killAt(runId, boundary);
    if (boundary === 'dispatch')
      await transaction(owner.organizationId, (tx) =>
        tx.query("UPDATE runs SET deadline=now()-interval '1 second' WHERE id=$1", [runId]),
      );
    await complete(runId);
    expect(call).not.toHaveBeenCalled();
    const result = await (await api(`runs/${runId}/result`)).json();
    expect(result.inference.outcome).toBe(boundary === 'dispatch' ? 'uncertain' : 'value');
  },
);

it.each([false, true])('fences late receipts, cancellation and retention (expired=%s)', async (expired) => {
  let release: (response: Response) => void = () => {};
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const runId = await submit();
  await advanceInference(owner.organizationId, runId);
  const dispatch = advanceInference(owner.organizationId, runId);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await api(`runs/${runId}/cancel`, 'POST', {});
  await complete(runId);
  const before = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
  expect(before.status).toBe('cancelled');
  expect(before.result.inference?.outcome).toBe('uncertain');
  if (expired) {
    const { expireDetailedHistory } = await import('../../packages/core/src/deletion');
    await transaction(owner.organizationId, async (tx) => {
      await tx.query("UPDATE runs SET completed_at=now()-interval '400 days' WHERE id=$1", [runId]);
      await expireDetailedHistory(tx, 'payg', new Date());
    });
  }
  release(
    Response.json({
      content: [{ type: 'text', text: '"review"' }],
      usage: { input_tokens: 100, output_tokens: 10 },
    }),
  );
  await dispatch;
  await complete(runId);
  const after = await transaction(owner.organizationId, (tx) => getRun(tx, runId));
  expect(after.status).toBe('cancelled');
  expect(after.cost_micro_usd).toBe(before.cost_micro_usd);
  expect(
    (
      await transaction(owner.organizationId, (tx) =>
        tx.query('SELECT state,response_ciphertext FROM decision_invocations WHERE run_id=$1', [runId]),
      )
    ).rows[0],
  ).toMatchObject(
    expired
      ? { state: 'uncertain', response_ciphertext: null }
      : { state: 'responded', response_ciphertext: expect.any(String) },
  );
});

it('submits, streams, waits, retrieves and cancels using the generated client over real HTTP', async () => {
  enable();
  const networkFetch = globalThis.fetch,
    server = await fixtureHttpApi();
  provider();
  const client = new Client({ baseURL: server.origin, apiKey: key, fetch: networkFetch });
  try {
    const accepted = await client.request('createInference', { body: input() });
    const work = complete(accepted.run_id);
    const events = [];
    for await (const event of client.stream(accepted.run_id, { signal: AbortSignal.timeout(10000) }))
      events.push(event.type);
    await work;
    expect(events).toContain('run.succeeded');
    expect((await client.runs.wait(accepted.run_id)).inference?.value).toBe('review');
    expect((await client.runs.getResult(accepted.run_id)).inference?.validation.status).toBe('passed');
    const queued = await client.request('createInference', { body: input(), headers: { Prefer: 'respond-async' } });
    await client.runs.cancel(queued.run_id);
    expect((await client.runs.get(queued.run_id)).status).toBe('cancelled');
  } finally {
    await server.close();
  }
});

it.each(['triage', 'actor'] as const)(
  '%s preserves abstention, stale context and application dependency tokens',
  async (scenario) => {
    const { decisionExample } = await import('../../examples/decisions/contracts');
    const body = decisionExample(workspaceId, scenario);
    provider('unknown');
    const runId = await submit(body);
    await complete(runId);
    expect((await (await api(`runs/${runId}/result`)).json()).inference).toMatchObject({
      outcome: 'unknown',
      reason_code: 'declared_unknown',
      dependency_tokens: body.context.dependency_tokens,
    });
    const pending = await submit(body);
    await advanceInference(owner.organizationId, pending);
    await transaction(owner.organizationId, (tx) =>
      tx.query(
        "UPDATE decision_invocations SET context_expires_at=now()-interval '1 second' WHERE run_id=$1",
        [pending],
      ),
    );
    await complete(pending);
    const stale = (await (await api(`runs/${pending}/result`)).json()).inference;
    expect(stale).toMatchObject({ outcome: 'stale_input', provider_outcome: 'not_invoked' });
    expect(stale).not.toHaveProperty('value');
  },
);
it('requires exact BYOK credentials and stops a prepared call when its artifact is released', async () => {
  const call = provider();
  enable();
  const body = input();
  body.model_binding = { ...body.model_binding, billing_mode: 'byok', provider_connection_id: id() };
  expect((await api('inferences', 'POST', body)).status).toBe(404);
  expect(call).not.toHaveBeenCalled();
  const ordinary = input();
  const snapshot = await (
    await api('context-artifacts', 'POST', {
      workspace_id: workspaceId,
      name: 'Revocable snapshot',
      context: ordinary.context,
    })
  ).json();
  const runId = await submit({
    ...ordinary,
    context: { artifact_id: snapshot.id, revision: snapshot.revision, audience: ordinary.context.audience },
  });
  await advanceInference(owner.organizationId, runId);
  expect((await api(`artifacts/${snapshot.id}`, 'DELETE')).status).toBe(204);
  await complete(runId);
  expect(call).not.toHaveBeenCalled();
  expect((await transaction(owner.organizationId, (tx) => getRun(tx, runId))).cost_micro_usd).toBe('0');
});
it('serializes competing dispatchers around one external request', async () => {
  let release!: (response: Response) => void;
  const call = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal('fetch', call);
  const runId = await submit();
  await advanceInference(owner.organizationId, runId);
  const first = advanceInference(owner.organizationId, runId);
  await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
  expect(await advanceInference(owner.organizationId, runId)).toMatchObject({ done: false });
  release(
    Response.json({
      content: [{ type: 'text', text: '"review"' }],
      usage: { input_tokens: 100, output_tokens: 10 },
    }),
  );
  await first;
  await Promise.all([complete(runId), complete(runId)]);
  expect(call).toHaveBeenCalledOnce();
  expect((await transaction(owner.organizationId, (tx) => getRun(tx, runId))).cost_micro_usd).toBe('150');
});
it('retains independently published evidence after authoring diagnostics expire, then explicitly releases it', async () => {
  const { expireDetailedHistory } = await import('../../packages/core/src/deletion');
  const { storedContextReader } = await import('../../packages/core/src/context-artifacts');
  provider();
  const runId = await submit();
  await complete(runId);
  const context = input().context;
  const snapshot = await (
    await api('context-artifacts', 'POST', {
      workspace_id: workspaceId,
      name: 'Published evidence',
      source_run_id: runId,
      context,
    })
  ).json();
  await transaction(owner.organizationId, async (tx) => {
    await tx.query("UPDATE runs SET completed_at=now()-interval '400 days' WHERE id=$1", [runId]);
    await expireDetailedHistory(tx, 'payg', new Date());
  });
  expect((await transaction(owner.organizationId, (tx) => getRun(tx, runId))).result.content_expired).toBe(
    true,
  );
  const reference = { artifact_id: snapshot.id, revision: snapshot.revision, audience: context.audience };
  expect(await storedContextReader.read(application, workspaceId, reference)).toEqual(context);
  expect((await api(`artifacts/${snapshot.id}`, 'DELETE')).status).toBe(204);
  await expect(storedContextReader.read(application, workspaceId, reference)).rejects.toMatchObject({
    status: 404,
  });
});
it('measures platform stages and persisted footprint for the small inline fixture', async () => {
  const pg = (await import('pg')).default;
  const queries = vi.spyOn(pg.Client.prototype, 'query');
  provider();
  const started = performance.now();
  let runId: string,
    sqlStatements = 0,
    sqlWrites = 0;
  try {
    runId = await submit();
    await complete(runId);
    sqlStatements = queries.mock.calls.length;
    sqlWrites = queries.mock.calls.filter(
      ([query]) => typeof query === 'string' && /^(INSERT|UPDATE|DELETE)/i.test(query),
    ).length;
  } finally {
    queries.mockRestore();
  }
  const elapsed = performance.now() - started;
  const result = (await (await api(`runs/${runId}/result`)).json()).inference;
  expect(result.timings_ms).toMatchObject({
    admission: expect.any(Number),
    queue_wait: expect.any(Number),
    provider: expect.any(Number),
    validation: expect.any(Number),
    context_resolution: expect.any(Number),
    response_persistence: expect.any(Number),
  });
  const footprint = await transaction(owner.organizationId, async (tx) => ({
    run: (await tx.query('SELECT pg_column_size(r) AS bytes FROM runs r WHERE id=$1', [runId])).rows[0].bytes,
    invocation: (
      await tx.query('SELECT pg_column_size(i) AS bytes FROM decision_invocations i WHERE run_id=$1', [runId])
    ).rows[0].bytes,
    artifacts: (
      await tx.query("SELECT count(*)::integer AS count FROM artifacts WHERE data->>'run_id'=$1", [runId])
    ).rows[0].count,
  }));
  expect(footprint.artifacts).toBe(0);
  // Fixture application budget, not a hosted service promise.
  expect(elapsed).toBeLessThan(5000);
  const measurement = JSON.stringify({
    elapsed_ms: Math.round(elapsed),
    sql_statements: sqlStatements,
    sql_writes: sqlWrites,
    timings_ms: result.timings_ms,
    footprint,
  });
  console.info('Inline decision fixture measurement', measurement);
  if (process.env.DECISION_MEASUREMENT_FILE)
    await (await import('node:fs/promises')).writeFile(process.env.DECISION_MEASUREMENT_FILE, measurement);
});

it('isolates identical audiences across application workspaces and tenants', async () => {
  const { storedContextReader } = await import('../../packages/core/src/context-artifacts');
  const { fixtureAccount } = await import('../fixtures/account');
  const snapshot = await (
    await api('context-artifacts', 'POST', {
      workspace_id: workspaceId,
      name: 'Private actor evidence',
      context: input().context,
    })
  ).json();
  const reference = { artifact_id: snapshot.id, revision: snapshot.revision, audience: snapshot.audience };
  const sibling = await transaction(owner.organizationId, (tx) =>
    resources.create(tx, 'workspaces', owner.organizationId, { name: 'Other application' }),
  );
  await expect(
    storedContextReader.read({ ...application, workspaceIds: [sibling.id] }, sibling.id, reference),
  ).rejects.toMatchObject({ status: 404 });
  const foreign = await fixtureAccount('Foreign decision tenant');
  await expect(
    storedContextReader.read(
      { ...application, organizationId: foreign.p.organizationId },
      workspaceId,
      reference,
    ),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    storedContextReader.read({ ...application, scopes: ['runs:write'] }, workspaceId, reference),
  ).rejects.toMatchObject({ status: 403 });
  expect((await api('inferences', 'POST', { ...input(), workspace_id: sibling.id })).status).toBe(404);
});
