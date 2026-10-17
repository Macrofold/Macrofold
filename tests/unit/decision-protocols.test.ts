import { afterEach, expect, it, vi } from 'vitest';
import { decisionExample } from '../../examples/decisions/contracts';
import { decisionProtocol } from '../../packages/providers/src/decision-protocols';
import { validateContext, schemaValidator, digest } from '../../packages/core/src/explicit-context';
import {
  DecisionProviderError,
  inferenceInputBound,
  type DecisionRequest,
} from '../../packages/core/src/decision';
import { decisionModel } from '../../packages/core/src/decision-models';
import { validateModelParameters } from '../../packages/core/src/model-parameters';

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
  expect(() => protocol.prepare(input)).toThrow('Decision models support choice and score');
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
it.each(['typesafe/jev-1.13', 'microsoft/microsoft-decision-1'])(
  'routes %s through Decisions with reviewed prices and no chat, tools or streaming',
  (model) => {
    const protocol = decisionProtocol('openrouter', model);
    const input = { ...request(), model };
    expect(protocol.prepare(input)).toEqual({
      ...decisionProtocol('typesafe').prepare(input),
      provider: { allow_fallbacks: false, max_price: { prompt: 0.042, completion: 0, request: 0 } },
    });
    expect(protocol.capabilities.brokeredTools).toBe(false);
    expect(protocol.capabilities.streaming).toBe(false);
    expect(() =>
      protocol.prepare({ ...input, definition: { ...input.definition, question: { kind: 'json' } } }),
    ).toThrow('Decision models support choice and score');
    expect(() => validateModelParameters({ reasoning: { effort: 'high' } }, 'openrouter', model)).toThrow(
      'OpenRouter chat model',
    );
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
        expect.objectContaining({ status: 400, code: 'decision_model_unavailable' }),
      );
    }
    expect(() => decisionProtocol('unknown')).toThrow('Unsupported decision provider');
  },
);

it('preserves native Decision 1 questions and complete responses without applying chat input rules', async () => {
  const protocol = decisionProtocol('openrouter', 'microsoft/microsoft-decision-1');
  const input = {
    state: { type: 'image', description: 'An ordinary business record, not chat image input.' },
    questions: {
      permitted: { type: 'noul', instructions: 'Does the record describe an image?' },
      team: { type: 'choice', instructions: 'Which team?', criteria: { support: 'General questions' } },
      priority: { type: 'score', instructions: 'How urgent?', criteria: ['Low', 'High'] },
    },
    provider: { order: ['azure'] },
  };
  const body = protocol.prepare({
    ...request(),
    model: 'microsoft/microsoft-decision-1',
    input,
    definition: { ...request().definition, question: { kind: 'provider' } },
  });
  expect(body).toEqual({
    ...input,
    model: 'microsoft/microsoft-decision-1',
    provider: {
      order: ['azure'],
      allow_fallbacks: false,
      max_price: { prompt: 0.042, completion: 0, request: 0 },
    },
  });
  expect(inferenceInputBound(body, 'openrouter', 'microsoft/microsoft-decision-1', true)).toBe(
    Buffer.byteLength(JSON.stringify(body)) + 1024,
  );
  const raw = {
    id: 'decision-1-fixture',
    model: 'microsoft/microsoft-decision-1-20261009',
    provider: 'Azure',
    answers: {
      permitted: { type: 'noul', noul: 0.9 },
      team: { type: 'choice', choice: 'support', probabilities: { support: 1 } },
      priority: { type: 'score', score: 0.4, probabilities: { '0': 0.6, '1': 0.4 } },
    },
    usage: { input_tokens: 1000, output_tokens: 70, cost: 0.000042 },
  };
  const call = vi.fn(async () => Response.json(raw));
  vi.stubGlobal('fetch', call);
  const result = await protocol.invoke(body, 'fixture', AbortSignal.timeout(1000), undefined, true);
  expect(result.httpStatus).toBe(200);
  expect(result.value).toEqual(raw);
  expect(result.usage).toMatchObject({
    input: 1000,
    output: 70,
    complete: true,
    providerReportedCostUsd: 0.000042,
  });
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'https://openrouter.ai/api/alpha/decisions',
    expect.objectContaining({ redirect: 'error' }),
  );
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
it('reuses immutable schema compilation without retaining or changing evidence', () => {
  const schema = {
    type: 'object',
    properties: { value: { enum: ['original'] } },
    required: ['value'],
    additionalProperties: false,
  };
  const first = schemaValidator(schema);
  expect(schemaValidator(JSON.parse(JSON.stringify(schema)))).toBe(first);
  schema.properties.value.enum[0] = 'changed';
  const changed = schemaValidator(schema);
  expect(changed({ value: 'changed' })).toBe(true);
  expect(first({ value: 'changed' })).toBe(false);
  const evidence = { value: 'original', extra: true };
  expect(first(evidence)).toBe(false);
  expect(evidence).toEqual({ value: 'original', extra: true });
  expect(() => schemaValidator({ ...schema, $ref: 'https://example.test/schema' })).toThrow();
});
it('evicts old compiled schemas while preserving validation after cache churn', () => {
  const schema = { type: 'string', const: 'eviction-fixture' };
  const first = schemaValidator(schema);
  for (let i = 0; i < 128; i++) schemaValidator({ type: 'number', const: i });
  const recompiled = schemaValidator(schema);
  expect(recompiled).not.toBe(first);
  expect(recompiled('eviction-fixture')).toBe(true);
  expect(recompiled('different')).toBe(false);
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

it('retains malformed output as private recovery evidence without trusting diagnostic observers', async () => {
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
  expect(result.providerResponse).toEqual(raw);
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

it.each([false, true])(
  'preserves OpenRouter reported costs for native response and decoded output (%s)',
  async (native) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          id: 'fixture',
          model: 'fixture/model',
          choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 5,
            cost: 0.00000123,
            cost_details: { upstream_inference_cost: 0.000001 },
          },
        }),
      ),
    );
    const result = await decisionProtocol('openrouter', 'fixture/model').invoke(
      { model: 'fixture/model' },
      'fixture',
      new AbortController().signal,
      undefined,
      native,
    );
    expect(result.usage).toMatchObject({
      providerReportedCostUsd: 0.00000123,
      upstreamInferenceCostUsd: 0.000001,
      complete: true,
    });
  },
);

it.each(['typesafe', 'anthropic', 'openrouter'] as const)(
  'retains independently valid usage after %s response normalization fails',
  async (provider) => {
    const raw = {
      id: 'normalization-fixture',
      model: 'fixture-revision',
      content: 'invalid',
      answers: 'invalid',
      usage: { input_tokens: 17, output_tokens: 3, cost: 0.000004 },
    };
    const call = vi.fn(async () => Response.json(raw));
    vi.stubGlobal('fetch', call);
    let failure: unknown;
    try {
      await decisionProtocol(provider).invoke({}, 'fixture-secret', AbortSignal.timeout(1000));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(DecisionProviderError);
    if (!(failure instanceof DecisionProviderError)) throw new Error('Expected private provider evidence');
    expect(failure.evidence).toMatchObject({
      response: raw,
      httpStatus: 200,
      requestId: 'normalization-fixture',
      modelRevision: 'fixture-revision',
      complete: true,
      usage: { input: 17, output: 3, complete: true },
    });
    expect(failure.evidence.completedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
    expect(failure.details).toEqual({});
    expect(JSON.stringify(failure)).not.toContain('normalization-fixture');
    expect(call).toHaveBeenCalledOnce();
  },
);
it('preserves known zero/output counts and provider cost when one usage count is malformed', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json({
      choices: [],
      usage: { prompt_tokens: 'wrong', completion_tokens: 0, cost: 0 },
    }),
  );
  await expect(
    decisionProtocol('openrouter', 'fixture/chat').invoke({}, 'fixture', AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({
    code: 'invalid_provider_usage',
    evidence: {
      complete: true,
      usage: {
        input: 0,
        output: 0,
        complete: false,
        known: { input: false, output: true },
        providerReportedCostUsd: 0,
      },
    },
  });
});
it.each([401, 429, 503])(
  'preserves bounded rejection body and its valid usage for HTTP %s',
  async (status) => {
    const raw = {
      error: { message: 'private provider detail' },
      usage: { input_tokens: 5, output_tokens: 1 },
    };
    const call = vi.fn(async () =>
      Response.json(raw, { status, headers: { 'x-request-id': 'rejected-fixture' } }),
    );
    vi.stubGlobal('fetch', call);
    await expect(
      decisionProtocol('typesafe').invoke({}, 'fixture', AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({
      code: 'decision_provider_failed',
      details: {},
      evidence: {
        httpStatus: status,
        response: raw,
        complete: true,
        requestId: 'rejected-fixture',
        usage: { input: 5, output: 1, complete: true },
      },
    });
    expect(call).toHaveBeenCalledOnce();
  },
);
it('retains malformed JSON privately and does not invent billable counts', async () => {
  vi.stubGlobal(
    'fetch',
    async () => new Response('{private malformed json', { headers: { 'request-id': 'malformed-fixture' } }),
  );
  await expect(
    decisionProtocol('anthropic').invoke({}, 'fixture', AbortSignal.timeout(1000)),
  ).rejects.toMatchObject({
    code: 'upstream_invalid_json',
    details: {},
    evidence: {
      response: '{private malformed json',
      httpStatus: 200,
      requestId: 'malformed-fixture',
      complete: true,
      usage: { complete: false },
    },
  });
});
it.each([200, 503])(
  'bounds oversized HTTP %s evidence and keeps transport uncertainty explicit',
  async (status) => {
    vi.stubGlobal('fetch', async () => new Response('x'.repeat(513 * 1024), { status }));
    await expect(
      decisionProtocol('anthropic').invoke({}, 'fixture', AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ evidence: { complete: false, completedAt: null, usage: { complete: false } } });
  },
);
it('does not duplicate successful native response data in evidence fields', async () => {
  const raw = {
    content: [{ type: 'text', text: 'plain native answer' }],
    usage: { input_tokens: 2, output_tokens: 3 },
  };
  vi.stubGlobal('fetch', async () => Response.json(raw));
  const result = await decisionProtocol('anthropic').invoke(
    {},
    'fixture',
    AbortSignal.timeout(1000),
    undefined,
    true,
  );
  expect(result.value).toEqual(raw);
  expect(result).not.toHaveProperty('providerResponse');
  expect(result.completedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
});

it('records stream completion before slow output delivery changes the local clock', async () => {
  vi.useFakeTimers();
  const completedAt = '2026-10-16T23:00:00.000Z';
  vi.setSystemTime(new Date(completedAt));
  const frames = [
    {
      type: 'message_start',
      message: { id: 'stream-time', content: [], usage: { input_tokens: 3, output_tokens: 0 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '"ok"' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ];
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      }),
  );
  try {
    const result = await decisionProtocol('anthropic').invoke(
      { stream: true },
      'fixture',
      new AbortController().signal,
      undefined,
      true,
      () => {
        vi.setSystemTime(new Date('2026-10-16T23:00:10.000Z'));
      },
    );
    expect(result.completedAt).toBe(completedAt);
    expect(result.usage.complete).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
