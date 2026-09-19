import { afterEach, expect, it, vi } from 'vitest';
import { decisionExample } from '../../examples/decisions/contracts';
import { decisionProtocol } from '../../packages/providers/src/decision-protocols';
import { validateContext, schemaValidator, digest } from '../../packages/core/src/explicit-context';
import type { DecisionRequest } from '../../packages/core/src/decision';
import { decisionModel } from '../../packages/core/src/decision-models';

function request(): DecisionRequest {
  const input = decisionExample('workspace', 'triage');
  return {
    model: 'jev-1.13.0',
    definition: input.definition,
    input: input.input,
    context: {
      ...input.context,
      organization_id: 'tenant',
      workspace_id: 'workspace',
      application_namespace: 'workspace',
      admitted_at: '2026-09-19T12:00:00Z',
    },
    maxOutputTokens: 256,
    rates: { inputMicroUsdPerMillion: '42000', outputMicroUsdPerMillion: '0' },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('maps Jev choice and score to distinct documented primitives without generation options', () => {
  const protocol = decisionProtocol('typesafe');
  const input = request();
  expect(protocol.prepare(input)).toEqual({
    model: 'jev-1.13.0',
    state: { input: input.input, context: input.context },
    questions: {
      decision: {
        type: 'choice',
        instructions: input.definition.prompt,
        criteria: input.definition.question.kind === 'choice' ? input.definition.question.criteria : {},
      },
    },
  });
  input.definition.question = { kind: 'score', criteria: ['Low', 'Medium', 'High'] };
  expect(protocol.prepare(input)).toHaveProperty('questions.decision.criteria', ['Low', 'Medium', 'High']);
  input.definition.question = { kind: 'json' };
  expect(() => protocol.prepare(input)).toThrow('Jev supports choice and score');
  expect(protocol.capabilities.brokeredTools).toBe(false);
});
it('preserves Jev evidence and exact usage behind fixed no-redirect transport', async () => {
  const call = vi.fn(async () =>
    Response.json(
      {
        model: 'jev-1.13.0',
        answers: {
          decision: {
            type: 'choice',
            choice: 'unknown',
            confidence: 0.8,
            probabilities: { unknown: 0.8, wait: 0.2 },
          },
        },
        usage: { input_tokens: 42, output_tokens: 0 },
      },
      { headers: { 'x-request-id': 'fixture' } },
    ),
  );
  vi.stubGlobal('fetch', call);
  const protocol = decisionProtocol('typesafe'),
    body = protocol.prepare(request());
  const result = await protocol.invoke(body, 'fixture-secret', AbortSignal.timeout(1000));
  expect(result).toMatchObject({
    value: 'unknown',
    requestId: 'fixture',
    evidence: { confidence: 0.8 },
    usage: { input: 42, output: 0, complete: true },
  });
  expect(call.mock.calls[0]).toBeDefined();
  expect(call).toHaveBeenCalledWith(
    'https://api.typesafe.ai/v1/systemone',
    expect.objectContaining({
      redirect: 'error',
      headers: expect.objectContaining({ authorization: 'Bearer fixture-secret' }),
    }),
  );
  expect(JSON.stringify(body)).not.toContain('fixture-secret');
});
it.each([-0.1, 1.1])('rejects invalid provider confidence %s', async (confidence) => {
  vi.stubGlobal('fetch', async () =>
    Response.json({ answers: { decision: { type: 'score', score: 1, confidence } } }),
  );
  await expect(
    decisionProtocol('typesafe').invoke({}, 'fixture', AbortSignal.timeout(1000)),
  ).rejects.toThrow();
});
it('keeps refusal, malformed output, and missing usage distinct', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ stop_reason: 'refusal', content: [] }));
  const protocol = decisionProtocol('anthropic');
  const refused = await protocol.invoke({}, 'fixture', AbortSignal.timeout(1000));
  expect(refused.refused).toBe(true);
  expect(refused.usage.complete).toBe(false);
  vi.stubGlobal('fetch', async () => Response.json({ content: [{ type: 'text', text: 'invalid json' }] }));
  const malformed = await protocol.invoke({}, 'fixture', AbortSignal.timeout(1000));
  expect(malformed.refused).toBe(false);
  expect(malformed.value).toBeUndefined();
});
it('uses OpenRouter decision routing and accepted price ceilings without enabling chat or tools', () => {
  const protocol = decisionProtocol('openrouter');
  const input = { ...request(), model: 'typesafe/jev-1.13' };
  expect(protocol.prepare(input)).toEqual({
    ...decisionProtocol('typesafe').prepare(input),
    provider: { allow_fallbacks: false, max_price: { prompt: 0.042, completion: 0, request: 0 } },
  });
  expect(protocol.capabilities.brokeredTools).toBe(false);
  expect(() =>
    protocol.prepare({ ...input, definition: { ...input.definition, question: { kind: 'json' } } }),
  ).toThrow('Jev supports choice and score');
  expect(
    decisionModel({ provider: 'openrouter', model: input.model, billing_mode: 'managed' }),
  ).toMatchObject({
    provider: 'openrouter',
    id: input.model,
    harnesses: [],
    input_micro_usd_per_million: '42000',
  });
  for (const model of ['~typesafe/jev-latest', 'openrouter/auto', 'jev-1.13.0']) {
    expect(() => decisionModel({ provider: 'openrouter', model, billing_mode: 'managed' })).toThrow(
      'explicitly supported decision model',
    );
  }
  expect(() => decisionProtocol('unknown')).toThrow('Unsupported decision provider');
});
it.each(['choice', 'score'] as const)(
  'decodes OpenRouter %s evidence and generation identity',
  async (kind) => {
    const value = kind === 'choice' ? 'unknown' : 1.25;
    const call = vi.fn(async () =>
      Response.json({
        id: 'gen-decision-fixture',
        model: 'typesafe/jev-1.13-20260917',
        answers: { decision: { type: kind, [kind]: value, confidence: 0.8 } },
        usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
      }),
    );
    vi.stubGlobal('fetch', call);
    const signal = AbortSignal.timeout(1000);
    const result = await decisionProtocol('openrouter').invoke({}, 'openrouter-fixture', signal);
    expect(result).toMatchObject({
      value,
      requestId: 'gen-decision-fixture',
      modelRevision: 'typesafe/jev-1.13-20260917',
      usage: { input: 476, output: 70, complete: true },
      evidence: { confidence: 0.8 },
    });
    expect(call).toHaveBeenCalledExactlyOnceWith(
      'https://openrouter.ai/api/alpha/decisions',
      expect.objectContaining({
        signal,
        redirect: 'error',
        headers: expect.objectContaining({ authorization: 'Bearer openrouter-fixture' }),
      }),
    );
  },
);
it('retains missing OpenRouter usage as provisional and accepts its generation header', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json(
      { answers: { decision: { type: 'choice', choice: 'unknown' } } },
      { headers: { 'x-generation-id': 'gen-header' } },
    ),
  );
  const result = await decisionProtocol('openrouter').invoke({}, 'fixture', AbortSignal.timeout(1000));
  expect(result.requestId).toBe('gen-header');
  expect(result.usage.complete).toBe(false);
});
it.each([401, 429, 503])('never retries or switches provider after OpenRouter status %s', async (status) => {
  const call = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal('fetch', call);
  await expect(
    decisionProtocol('openrouter').invoke({}, 'fixture', AbortSignal.timeout(1000)),
  ).rejects.toThrow('decision provider');
  expect(call).toHaveBeenCalledTimes(1);
});
it.each(['triage', 'actor'] as const)(
  '%s treats unknown as a record, never an invented known value',
  (scenario) => {
    const example = decisionExample('workspace', scenario);
    expect(() => validateContext(example.definition, example.input, example.context)).not.toThrow();
    example.definition.required_known = ['observation'];
    expect(() => validateContext(example.definition, example.input, example.context)).toThrow('not known');
    delete example.definition.required_known;
    example.context.items = [];
    expect(() => validateContext(example.definition, example.input, example.context)).toThrow('absent');
  },
);
it.each([
  { $ref: 'https://example.test/schema' },
  { type: 'string', pattern: '(a+)+' },
  { anyOf: [{ type: 'string' }, { type: 'number' }] },
])('rejects unbounded schema features %j', (schema) => {
  expect(() => schemaValidator(schema)).toThrow();
});
it('rejects inconsistent or incomplete evidence without coercion', () => {
  const example = decisionExample('workspace', 'actor');
  example.context.truncated = true;
  expect(() => validateContext(example.definition, example.input, example.context)).toThrow('complete');
  example.context.truncated = false;
  example.context.consistency = 'read_interval';
  example.context.read_completed_at = example.context.observed_at;
  expect(() => validateContext(example.definition, example.input, example.context)).toThrow('snapshot');
});
it('shadow comparison records disagreement without choosing or applying a provider answer', async () => {
  const cases = [
    { signal: false, rule: 'wait', generative: 'wait', jev: 'wait' },
    { signal: true, rule: 'investigate', generative: 'investigate', jev: 'wait' },
    { signal: null, rule: 'unknown', generative: 'unknown', jev: 'unknown' },
  ];
  const comparisons = [];
  for (const entry of cases) {
    vi.stubGlobal('fetch', async (url: RequestInfo | URL) =>
      String(url).includes('typesafe')
        ? Response.json({ answers: { decision: { type: 'choice', choice: entry.jev } } })
        : Response.json({ content: [{ type: 'text', text: JSON.stringify(entry.generative) }] }),
    );
    const input = request();
    input.context.items[0].value = entry.signal;
    const generative = await decisionProtocol('anthropic').invoke(
      decisionProtocol('anthropic').prepare(input),
      'fixture',
      AbortSignal.timeout(1000),
    );
    const jev = await decisionProtocol('typesafe').invoke(
      decisionProtocol('typesafe').prepare(input),
      'fixture',
      AbortSignal.timeout(1000),
    );
    comparisons.push({
      context: digest(input.context),
      rule: entry.rule,
      generative: generative.value,
      jev: jev.value,
      accepted: false,
    });
  }
  expect(comparisons.filter((row) => row.generative !== row.jev)).toHaveLength(1);
  expect(comparisons.every((row) => row.accepted === false)).toBe(true);
});

it('offers raw responses to transient diagnostics before validation without persisting or trusting observers', async () => {
  const raw = { content: [{ type: 'text', text: 'invalid json, preserved for diagnosis' }] };
  vi.stubGlobal('fetch', async () => Response.json(raw));
  const observe = vi.fn();
  const result = await decisionProtocol('anthropic').invoke(
    {},
    'fixture',
    AbortSignal.timeout(1000),
    observe,
  );
  expect(observe).toHaveBeenCalledWith(raw);
  expect(result.value).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain('preserved for diagnosis');
  await expect(
    decisionProtocol('anthropic').invoke({}, 'fixture', AbortSignal.timeout(1000), () => {
      throw new Error('unavailable');
    }),
  ).resolves.toMatchObject({ refused: false });
  vi.stubGlobal('fetch', async () => Response.json({ answers: 'invalid' }));
  observe.mockClear();
  await expect(
    decisionProtocol('openrouter').invoke({}, 'fixture', AbortSignal.timeout(1000), observe),
  ).rejects.toThrow();
  expect(observe).toHaveBeenCalledWith({ answers: 'invalid' });
});
