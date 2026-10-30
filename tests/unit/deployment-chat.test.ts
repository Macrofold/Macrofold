import { expect, it, vi } from 'vitest';
import {
  deploymentProtocol,
  prepareDeploymentChat,
  prepareDeploymentSystemOne,
} from '../../packages/providers/src/deployment-chat';
import type {
  DeploymentTarget,
  ModelDeploymentCapabilities,
} from '../../packages/core/src/model-deployment-types';
import type { DecisionRequest, InferenceOutput } from '../../packages/core/src/decision';
import { DecisionProviderError } from '../../packages/core/src/decision';

function target(overrides: Partial<ModelDeploymentCapabilities> = {}): DeploymentTarget {
  return {
    deployment_id: '11111111-1111-4111-8111-111111111111',
    deployment_revision_id: '22222222-2222-4222-8222-222222222222',
    endpoint_connection_id: '33333333-3333-4333-8333-333333333333',
    endpoint_url: 'https://models.example.test/v1',
    model_alias: 'pinned-model',
    capabilities: {
      protocol: 'openai_chat',
      input_modalities: ['text'],
      chat_completions: true,
      json_object: true,
      json_schema: true,
      tools: true,
      streaming: true,
      stream_usage: true,
      schema_keywords: ['type', 'properties', 'required', 'additionalProperties', 'enum'],
      accepted_parameters: ['temperature', 'top_p', 'n'],
      schema_dialect: '2020-12',
      context_window_tokens: 8192,
      max_output_tokens: 1024,
      max_concurrent_requests: 4,
      ...overrides,
    },
  };
}
function request(input: Record<string, unknown> = {}): DecisionRequest & { input: Record<string, unknown> } {
  return {
    model: 'pinned-model',
    input: { messages: [{ role: 'user', content: 'Synthetic hello' }], ...input },
    maxOutputTokens: 128,
    rates: { inputMicroUsdPerMillion: '0', outputMicroUsdPerMillion: '0' },
    definition: {
      revision: 'native-provider/1',
      prompt: 'Native provider request',
      question: { kind: 'provider' },
      input_schema: {},
      output_schema: {},
      allowed_models: [],
      limits: { max_cost_micro_usd: '0', max_output_tokens: 128, timeout_seconds: 30 },
    },
    context: {
      schema_version: 1,
      template_revision: 'native-provider/1',
      audience: { kind: 'application', id: 'synthetic' },
      items: [],
      complete: true,
      truncated: false,
      consistency: 'snapshot',
      observed_at: new Date().toISOString(),
      dependency_tokens: {},
      organization_id: '11111111-1111-4111-8111-111111111111',
      workspace_id: null,
      application_namespace: 'synthetic',
      admitted_at: new Date().toISOString(),
    },
  };
}
function response(extra: Record<string, unknown> = {}) {
  return {
    id: 'completion-1',
    model: 'pinned-model',
    choices: [
      { index: 0, message: { role: 'assistant', content: 'Synthetic answer' }, finish_reason: 'stop' },
    ],
    usage: { prompt_tokens: 7, completion_tokens: 3 },
    ...extra,
  };
}

function systemOneTarget(): DeploymentTarget {
  return target({
    protocol: 'systemone',
    chat_completions: false,
    json_object: false,
    json_schema: false,
    tools: false,
    streaming: false,
    stream_usage: false,
    schema_keywords: [],
    accepted_parameters: [],
    schema_dialect: null,
  });
}
function systemOneRequest(
  input: Record<string, unknown> = {},
): DecisionRequest & { input: Record<string, unknown> } {
  return {
    ...request(),
    input: {
      state: { food: 2, hunger: 8 },
      questions: {
        'arbitrary choice': { type: 'choice', criteria: { eat: 'Use available food', wait: 'Do nothing' } },
        'needs food': { type: 'noul', instructions: 'Is food needed?' },
        urgency: { type: 'score', criteria: ['Routine', 'Urgent'] },
      },
      ...input,
    },
  };
}

it('accepts explicit nonstreaming without forwarding a transport field to native scoring', () => {
  const native = systemOneRequest({ stream: false });
  const protocol = deploymentProtocol(systemOneTarget(), {});
  expect(protocol.prepare(native)).not.toHaveProperty('stream');
  expect(native.input.stream).toBe(false);
  expect(() => protocol.prepare({ ...native, stream: true })).toThrow();
});

it('preserves native SystemOne state, question names and prepared bytes without chat fields', async () => {
  const native = systemOneRequest();
  const before = structuredClone(native.input);
  const raw = {
    model: 'pinned-model',
    answers: {
      'arbitrary choice': {
        type: 'choice',
        choice: 'eat',
        confidence: 0.9,
        probabilities: { eat: 0.9, wait: 0.1 },
      },
      'needs food': { type: 'noul', noul: 0.95 },
      urgency: { type: 'score', score: 0.8, probabilities: { '0': 0.2, '1': 0.8 } },
    },
    usage: { input_tokens: 42, output_tokens: 0 },
    latency_ms: 12.5,
    truncated: false,
  };
  const transport = vi.fn(async () =>
    Response.json(raw, { headers: { 'x-typesafe-request-id': 'systemone-request' } }),
  );
  const protocol = deploymentProtocol(
    systemOneTarget(),
    { Authorization: 'Bearer fixture-systemone' },
    30,
    transport,
  );
  const body = protocol.prepare(native);
  const encoded = JSON.stringify(body, null, 2);
  expect(body).toEqual({ ...before, model: 'pinned-model' });
  expect(native.input).toEqual(before);
  expect(body).not.toHaveProperty('messages');
  const result = await protocol.invoke(
    body,
    '',
    new AbortController().signal,
    undefined,
    true,
    undefined,
    encoded,
  );
  expect(result).toMatchObject({
    value: raw,
    requestId: 'systemone-request',
    modelRevision: systemOneTarget().deployment_revision_id,
    usage: { input: 42, output: 0, complete: true },
  });
  expect(transport).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledWith(
    new URL('https://models.example.test/v1/systemone'),
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: expect.objectContaining({ Authorization: 'Bearer fixture-systemone' }),
      body: encoded,
    }),
    { timeoutMs: 30000, maximumResponseBytes: 8 * 1024 * 1024 },
  );
});

it.each([{ stream: true }, { modelParameters: { reasoning: { effort: 'low' as const } } }])(
  'rejects unsupported SystemOne options before transport: %j',
  (overrides) => {
    const transport = vi.fn();
    const protocol = deploymentProtocol(systemOneTarget(), {}, 30, transport);
    expect(() => protocol.prepare({ ...systemOneRequest(), ...overrides })).toThrow(
      expect.objectContaining({ code: 'unsupported_model_capability' }),
    );
    expect(protocol.capabilities.streaming).toBe(false);
    expect(transport).not.toHaveBeenCalled();
  },
);

it.each([
  { questions: {} },
  { questions: null },
  { state: undefined },
  { model: 'another-model' },
  { messages: [{ role: 'user', content: 'Not a scoring request' }] },
])('rejects invalid SystemOne requests before transport: %j', (input) => {
  expect(() => prepareDeploymentSystemOne(systemOneTarget(), systemOneRequest(input))).toThrow();
});

it.each([
  { usage: { input_tokens: 42, output_tokens: 'invalid' }, code: 'invalid_provider_usage' },
  { answers: 'invalid', code: 'invalid_provider_response' },
])('retains independently known SystemOne usage after invalid output: %j', async ({ code, ...invalid }) => {
  const raw = {
    model: 'pinned-model',
    answers: {},
    usage: { input_tokens: 42, output_tokens: 0 },
    ...invalid,
  };
  const transport = vi.fn(async () => Response.json(raw));
  const protocol = deploymentProtocol(systemOneTarget(), {}, 30, transport);
  await expect(
    protocol.invoke(protocol.prepare(systemOneRequest()), '', new AbortController().signal),
  ).rejects.toMatchObject({
    code,
    evidence: { response: raw, complete: true, usage: { input: 42, known: { input: true } } },
  });
  expect(transport).toHaveBeenCalledOnce();
});

it('keeps missing SystemOne usage unknown instead of inventing free complete execution', async () => {
  const transport = vi.fn(async () => Response.json({ model: 'pinned-model', answers: {} }));
  const protocol = deploymentProtocol(systemOneTarget(), {}, 30, transport);
  const result = await protocol.invoke(
    protocol.prepare(systemOneRequest()),
    '',
    new AbortController().signal,
  );
  expect(result.usage.complete).toBe(false);
  expect(result.usage.known).toBeUndefined();
});

it('retains malformed SystemOne JSON privately without retrying', async () => {
  const raw = '{"private":"truncated';
  const transport = vi.fn(async () => new Response(raw));
  const protocol = deploymentProtocol(systemOneTarget(), {}, 30, transport);
  let failure: unknown;
  try {
    await protocol.invoke(protocol.prepare(systemOneRequest()), '', new AbortController().signal);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(DecisionProviderError);
  if (!(failure instanceof DecisionProviderError)) throw new Error('Expected private provider evidence.');
  expect(failure.evidence).toMatchObject({ response: raw, complete: true, usage: { complete: false } });
  expect(JSON.stringify(failure)).not.toContain('private');
  expect(transport).toHaveBeenCalledOnce();
});

it('preserves native messages, schemas and tool calls with aggregate output limits', () => {
  const native = request({
    n: 2,
    max_tokens: 64,
    temperature: 0.2,
    tools: [{ type: 'function', function: { name: 'observe', parameters: { type: 'object' } } }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'example',
        strict: true,
        schema: {
          type: 'object',
          properties: { label: { type: 'string', enum: ['a', 'b'] } },
          required: ['label'],
          additionalProperties: false,
        },
      },
    },
  });
  const before = structuredClone(native.input);
  const body = prepareDeploymentChat(target(), native);
  expect(body).toEqual({ ...before, model: 'pinned-model' });
  expect(native.input).toEqual(before);
  expect(body).not.toHaveProperty('provider');
});

it.each([
  [{ model: 'another-model' }, {}, 'invalid_deployment_binding'],
  [{ max_tokens: 127 }, {}, 'unsupported_model_capability'],
  [{ invented: true }, {}, 'unsupported_model_capability'],
  [{ response_format: { type: 'json_object' } }, { json_object: false }, 'unsupported_model_capability'],
  [{ tools: [] }, { tools: false }, 'unsupported_model_capability'],
  [
    {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: 'https://example.test/a.png' }] }],
    },
    {},
    'unsupported_model_capability',
  ],
  [{ provider: { allow_fallbacks: true } }, {}, 'unsupported_model_capability'],
] as const)('rejects unsupported native request %j before transport', (input, caps, code) => {
  expect(() => prepareDeploymentChat(target(caps), request(input))).toThrow(
    expect.objectContaining({ code }),
  );
});

it('rejects unsupported schema keywords without dropping them or changing output mode', () => {
  expect(() =>
    prepareDeploymentChat(
      target(),
      request({
        response_format: {
          type: 'json_schema',
          json_schema: { schema: { type: 'string', pattern: '^a$' } },
        },
      }),
    ),
  ).toThrow(expect.objectContaining({ code: 'unsupported_model_capability' }));
});

it.each([true, false])('preserves explicitly supported native thinking control: %s', (enable_thinking) => {
  const input = request({ chat_template_kwargs: { enable_thinking } });
  const before = structuredClone(input.input);
  const configured = target({ accepted_parameters: ['chat_template_kwargs'] });
  expect(prepareDeploymentChat(configured, input)).toEqual({
    ...before,
    model: 'pinned-model',
    max_tokens: 128,
  });
  expect(input.input).toEqual(before);
  expect(() => prepareDeploymentChat(target(), input)).toThrow(
    expect.objectContaining({ code: 'unsupported_model_capability' }),
  );
});

it.each([{ enable_thinking: 'false' }, { chat_template: 'replacement' }, { messages: [] }])(
  'rejects unsupported template settings before transport: %j',
  (kwargs) => {
    expect(() =>
      prepareDeploymentChat(
        target({ accepted_parameters: ['chat_template_kwargs'] }),
        request({ chat_template_kwargs: kwargs }),
      ),
    ).toThrow(expect.objectContaining({ code: 'unsupported_model_capability' }));
  },
);

it.each([null, []])('rejects malformed native template kwargs: %j', (kwargs) => {
  expect(() =>
    prepareDeploymentChat(
      target({ accepted_parameters: ['chat_template_kwargs'] }),
      request({ chat_template_kwargs: kwargs }),
    ),
  ).toThrow(expect.objectContaining({ status: 400, code: 'invalid_request' }));
});

it.each([
  null,
  [],
  { messages: [null] },
  { messages: [{ role: 'user', content: [null] }] },
  { response_format: [] },
  { response_format: { type: 'json_schema', json_schema: [] } },
  { response_format: { type: 'json_schema', json_schema: { schema: null } } },
  { response_format: { type: 'json_schema', json_schema: { schema: { properties: [] } } } },
] as const)('reports malformed native request objects as client errors: %j', (input) => {
  const original = request();
  const native = {
    ...original,
    input: input === null || Array.isArray(input) ? input : { ...original.input, ...input },
  };
  expect(() => prepareDeploymentChat(target(), native)).toThrow(
    expect.objectContaining({ status: 400, code: 'invalid_request' }),
  );
});

it('reports malformed stream options as a client error before transport', () => {
  expect(() => prepareDeploymentChat(target(), { ...request({ stream_options: [] }), stream: true })).toThrow(
    expect.objectContaining({ status: 400, code: 'invalid_request' }),
  );
});

it('makes one authenticated request and returns the complete native payload and independent usage', async () => {
  const raw = response({
    provider_extra: { retained: true },
    usage: { prompt_tokens: 7, completion_tokens: 3, cost: 999 },
  });
  const transport = vi.fn().mockResolvedValue(Response.json(raw));
  const protocol = deploymentProtocol(target(), { Authorization: 'Bearer fixture-only' }, 120, transport);
  const result = await protocol.invoke(protocol.prepare(request()), '', new AbortController().signal);
  expect(result.value).toEqual(raw);
  expect(result.modelRevision).toBe(target().deployment_revision_id);
  expect(result.usage).toMatchObject({ input: 7, output: 3, complete: true });
  expect(result.usage).not.toHaveProperty('providerReportedCostUsd');
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport).toHaveBeenCalledWith(
    new URL('https://models.example.test/v1/chat/completions'),
    expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: expect.objectContaining({ Authorization: 'Bearer fixture-only' }),
    }),
    { timeoutMs: 120000, maximumResponseBytes: 8 * 1024 * 1024 },
  );
});

it('keeps unknown token counts unknown and does not infer hosting costs', async () => {
  const transport = vi.fn().mockResolvedValue(Response.json(response({ usage: { completion_tokens: 0 } })));
  const protocol = deploymentProtocol(target(), {}, 30, transport);
  const result = await protocol.invoke(protocol.prepare(request()), '', new AbortController().signal);
  expect(result.usage).toMatchObject({ complete: false, output: 0, known: { input: false, output: true } });
  expect(result.usage).not.toHaveProperty('upstreamInferenceCostUsd');
});

it('rejects the wrong actual model while preserving private response/usage evidence', async () => {
  const transport = vi.fn().mockResolvedValue(Response.json(response({ model: 'wrong-model' })));
  const protocol = deploymentProtocol(target(), {}, 30, transport);
  let error: unknown;
  try {
    await protocol.invoke(protocol.prepare(request()), '', new AbortController().signal);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(DecisionProviderError);
  expect(error).toMatchObject({ code: 'model_not_authorized' });
  if (!(error instanceof DecisionProviderError)) throw new Error('Expected retained evidence');
  expect(error.evidence.usage).toMatchObject({ input: 7, output: 3, complete: true });
  expect(JSON.stringify(error)).not.toContain('wrong-model');
  expect(transport).toHaveBeenCalledTimes(1);
});

it('assembles streamed text and tool arguments with final usage under the existing SSE protocol', async () => {
  const frames =
    [
      {
        id: 'completion-1',
        model: 'pinned-model',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, id: 'call-1', function: { name: 'observe', arguments: '{"x":1}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },
    ]
      .map((frame) => `data: ${JSON.stringify(frame)}\n\n`)
      .join('') + 'data: [DONE]\n\n';
  const transport = vi
    .fn()
    .mockResolvedValue(new Response(frames, { headers: { 'content-type': 'text/event-stream' } }));
  const protocol = deploymentProtocol(target(), {}, 30, transport);
  const input = { ...request(), stream: true };
  const events: InferenceOutput[] = [];
  const result = await protocol.invoke(
    protocol.prepare(input),
    '',
    new AbortController().signal,
    undefined,
    true,
    (event) => {
      events.push(event);
    },
  );
  expect(events).toContainEqual(
    expect.objectContaining({ type: 'output.delta', data: expect.objectContaining({ text: 'Hello' }) }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'tool.arguments.delta',
      data: expect.objectContaining({ tool_call_id: 'call-1', text: '{"x":1}' }),
    }),
  );
  expect(result.value).toMatchObject({
    choices: [
      {
        message: {
          content: 'Hello',
          tool_calls: [{ id: 'call-1', function: { name: 'observe', arguments: '{"x":1}' } }],
        },
      },
    ],
  });
  expect(result.usage.complete).toBe(true);
});

it('retains incomplete stream evidence without claiming a successful answer or retrying', async () => {
  const transport = vi
    .fn()
    .mockResolvedValue(
      new Response(
        'data: {"model":"pinned-model","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
      ),
    );
  const protocol = deploymentProtocol(target(), {}, 30, transport);
  const result = await protocol.invoke(
    protocol.prepare({ ...request(), stream: true }),
    '',
    new AbortController().signal,
  );
  expect(result.incomplete).toBeDefined();
  expect(result.usage.complete).toBe(false);
  expect(transport).toHaveBeenCalledTimes(1);
});
