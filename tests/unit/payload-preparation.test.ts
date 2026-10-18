import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonical } from '../../packages/core/src/crypto';
import { createJsonPreparation } from '../../packages/core/src/prepared-json';
import { digest, validateContext } from '../../packages/core/src/explicit-context';
import { prepareInvocation } from '../../packages/core/src/inference-invocations';
import { inferenceConfiguration } from '../../packages/core/src/inferences';
import { boundedRequest } from '../../packages/core/src/bounded-decisions';
import type { InferenceConfig } from '../../packages/core/src/runs';
import { decisionProtocol } from '../../packages/providers/src/decision-protocols';
import { modelInputBound } from '../../packages/core/src/model-content';
import { inferenceInputBound, type DecisionRequest } from '../../packages/core/src/decision';
import { nativeInferenceBody } from '../../packages/providers/src/native-inference';
import { decisionExample } from '../../examples/decisions/contracts';

const configuration = { provider: 'anthropic', model: 'claude-sonnet-4-6', harness: 'claude-code' };
const encode = <T>(value: T) => {
  const json = canonical(value);
  return { value, json, bytes: Buffer.byteLength(json) };
};

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

it.each([
  { z: ['text', null, -0, 0.00001], a: { 文: 'é 😀', b: true } },
  { omitted: undefined, list: [undefined, NaN, Infinity, -Infinity] },
  { count: 1e21, empty: {}, array: [] },
])('reuses only explicitly remembered immutable roots without changing canonical output: %j', (value) => {
  freeze(value);
  const preparation = createJsonPreparation();
  const expected = canonical(value);
  expect(preparation.remember(value)).toEqual({ value, json: expected, bytes: Buffer.byteLength(expected) });
  expect(preparation.stringify({ nested: [value, value] })).toBe(canonical({ nested: [value, value] }));
  expect(preparation.stats().entries).toBe(1);
  preparation.dispose();
  expect(preparation.stats()).toEqual({
    entries: 0,
    retainedBytes: 0,
    peakBytes: Buffer.byteLength(expected),
  });
  expect(preparation.remember({ after: 'disposal' }).json).toBe('{"after":"disposal"}');
  expect(preparation.stats().entries).toBe(0);
});

it('bounds memo entries and bytes without rejecting or changing encodings', () => {
  const preparation = createJsonPreparation();
  for (let index = 0; index < 20; index++) {
    const value = { index };
    expect(preparation.remember(value).json).toBe(canonical(value));
  }
  expect(preparation.stats().entries).toBe(16);
  preparation.dispose();

  const largePreparation = createJsonPreparation();
  const large = { text: 'x'.repeat(8 * 1024 * 1024) };
  expect(largePreparation.remember(large).json).toBe(canonical(large));
  expect(largePreparation.stats()).toEqual({ entries: 0, retainedBytes: 0, peakBytes: 0 });
  largePreparation.dispose();
});

it('keeps submitted and admitted context digests distinct while reusing shared items', () => {
  const example = decisionExample('workspace', 'triage');
  freeze(example);
  const preparation = createJsonPreparation();
  try {
    const validated = validateContext(example.definition, example.input, example.context, preparation);
    const admitted = {
      ...example.context,
      organization_id: 'tenant',
      workspace_id: 'workspace',
      application_namespace: 'workspace',
      admitted_at: '2026-10-17T12:00:00Z',
    };
    expect(validated.context.json).toBe(canonical(example.context));
    expect(digest(admitted, preparation.stringify)).toBe(digest(admitted));
    expect(digest(admitted, preparation.stringify)).not.toBe(digest(example.context));
  } finally {
    preparation.dispose();
  }
});

it.each([
  ['anthropic', 'claude-haiku-4-5-20251001'],
  ['openrouter', 'openai/gpt-5.4-mini'],
  ['openrouter', 'typesafe/jev-1.13'],
] as const)(
  'preserves %s/%s provider bytes and uses fresh evidence for each invocation',
  (provider, model) => {
    const example = decisionExample('workspace', 'triage');
    const rate = {
      id: model,
      name: model,
      provider,
      harnesses: [],
      enabled: true,
      input_micro_usd_per_million: '42000',
      output_micro_usd_per_million: '100000',
    };
    const configuration: InferenceConfig = {
      executor_version: '1',
      execution_owner: 'request',
      transformation_version: decisionProtocol(provider, model).version,
      user_id: 'user',
      principal_id: 'key',
      principal_kind: 'api_key',
      workspace_ids: [],
      client_type: 'api',
      scheduling_class: 'interactive',
      model,
      billing_mode: 'managed',
      rate_card: rate,
      provider_cost_rate_card: rate,
      admission_ms: 0,
      limits: example.definition.limits,
      definition: example.definition,
      definition_digest: digest(example.definition),
      input: example.input,
      context: {
        ...example.context,
        organization_id: 'tenant',
        workspace_id: 'workspace',
        application_namespace: 'workspace',
        admitted_at: '2026-10-17T12:00:00Z',
      },
      context_digest: '',
    };
    configuration.context_digest = digest(configuration.context);
    freeze(configuration);
    const prepared = prepareInvocation(configuration);
    const expected = decisionProtocol(provider, model).prepare({
      model,
      definition: configuration.definition,
      input: configuration.input,
      context: configuration.context,
      maxOutputTokens: configuration.limits.max_output_tokens,
      rates: {
        inputMicroUsdPerMillion: rate.input_micro_usd_per_million,
        outputMicroUsdPerMillion: rate.output_micro_usd_per_million,
      },
    });
    expect(prepared.serialized).toBe(canonical(expected));
    expect(prepared.bytes).toBe(Buffer.byteLength(prepared.serialized));
    expect(prepared.contextDigest).toBe(configuration.context_digest);
    const changed = {
      ...configuration,
      context: { ...configuration.context, dependency_tokens: { newer: '8' } },
    };
    changed.context_digest = digest(changed.context);
    const next = prepareInvocation(changed);
    expect(next.serialized).not.toBe(prepared.serialized);
    expect(next.contextDigest).not.toBe(prepared.contextDigest);
  },
);

it('prepares bounded transformed schemas and step evidence without stale encodings', () => {
  const example = decisionExample('workspace', 'triage');
  example.definition.bounded_agent = { max_model_calls: 2, max_tool_calls: 0, context_artifacts: [] };
  const request: DecisionRequest = {
    model: 'claude-haiku-4-5-20251001',
    definition: example.definition,
    input: example.input,
    context: {
      ...example.context,
      organization_id: 'tenant',
      workspace_id: 'workspace',
      application_namespace: 'workspace',
      admitted_at: '2026-10-17T12:00:00Z',
    },
    steps: [{ artifact_id: 'artifact', context: { ...example.context, items: [] } }],
    maxOutputTokens: 256,
    rates: { inputMicroUsdPerMillion: '1000000', outputMicroUsdPerMillion: '5000000' },
  };
  freeze(request);
  const preparation = createJsonPreparation();
  try {
    preparation.remember(request.context.items);
    preparation.remember(request.context);
    const transformed = boundedRequest(request);
    const protocol = decisionProtocol('anthropic');
    expect(preparation.stringify(protocol.prepare(transformed, preparation.stringify))).toBe(
      canonical(protocol.prepare(transformed)),
    );
    expect(transformed.definition.output_schema).not.toEqual(request.definition.output_schema);
  } finally {
    preparation.dispose();
  }
});

it('preserves native wire rewrites without mutating frozen nested input', () => {
  const example = decisionExample('workspace', 'triage');
  const input = Object.freeze({
    messages: Object.freeze([Object.freeze({ role: 'user', content: 'Résumé 文' })]),
    provider: Object.freeze({ order: Object.freeze(['fixture']), allow_fallbacks: true }),
    mcp_servers: Object.freeze([]),
    max_tokens: 20,
  });
  const request: DecisionRequest = {
    model: 'fixture/model',
    definition: { ...example.definition, question: { kind: 'provider' } },
    input,
    context: {
      ...example.context,
      organization_id: 'tenant',
      workspace_id: 'workspace',
      application_namespace: 'workspace',
      admitted_at: '2026-10-17T12:00:00Z',
    },
    stream: true,
    maxOutputTokens: 30,
    rates: { inputMicroUsdPerMillion: '1000000', outputMicroUsdPerMillion: '2000000' },
  };
  expect(nativeInferenceBody(request, 'openrouter')).toEqual({
    messages: input.messages,
    max_tokens: 20,
    model: request.model,
    stream: true,
    stream_options: { include_usage: true },
    provider: {
      order: ['fixture'],
      allow_fallbacks: false,
      max_price: { prompt: 1, completion: 2, request: 0 },
    },
  });
  expect(input.provider.allow_fallbacks).toBe(true);
  expect(input.mcp_servers).toEqual([]);
});

it.each([
  { messages: [{ role: 'user', content: 'Résumé 文 😀' }], temperature: 0.2 },
  { input: [null, true, false, -0, 0.0001, { z: 1, a: ['text', 2] }] },
  { input: [], metadata: {} },
])('reuses exact text JSON byte bounds after media validation: %j', (payload) => {
  const expected = Buffer.byteLength(JSON.stringify(payload)) + 1024;
  expect(modelInputBound(payload, configuration)).toBe(expected);
  expect(modelInputBound(payload, configuration, encode(payload))).toBe(expected);
  expect(inferenceInputBound(payload, 'anthropic', configuration.model, true, encode(payload))).toBe(
    expected,
  );
  expect(modelInputBound(payload, configuration, encode({ different: 'object' }))).toBe(expected);
});

it('keeps projection behavior for internal values with non-JSON encoding semantics', () => {
  const cases = [
    { input: { omitted: undefined, count: Infinity } },
    { input: new Date('2026-10-17T12:00:00Z') },
    { input: { data: 'value', toJSON: () => 'serialized' } },
    { input: Array(2) },
    { input: Object.assign(['original'], { toJSON: () => ['replacement'] }) },
  ];
  const expected = [
    { input: { count: null } },
    { input: {} },
    { input: 'serialized' },
    { input: [null, null] },
    { input: ['original'] },
  ];
  for (const [index, payload] of cases.entries())
    expect(modelInputBound(payload, configuration, encode(payload))).toBe(
      Buffer.byteLength(JSON.stringify(expected[index])) + 1024,
    );
});

it('does not reuse a prepared text bound for images or bypass invalid media rejection', () => {
  const data = readFileSync('tests/fixtures/media/pixel.png').toString('base64');
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data } };
  const payload = { messages: [{ role: 'user', content: [image] }] };
  const projected = { messages: [{ role: 'user', content: [{ type: 'validated_image' }] }] };
  expect(modelInputBound(payload, configuration, encode(payload))).toBe(
    Buffer.byteLength(JSON.stringify(projected)) + 1024 + 32_768,
  );
  const invalid = { messages: [{ type: 'document', source: { data: 'unmetered' } }] };
  expect(() => modelInputBound(invalid, configuration, encode(invalid))).toThrow('accepts text');
});

it('encodes queued native request content once instead of memoizing unused explicit evidence', () => {
  const example = decisionExample('workspace', 'triage');
  const content = 'Unique native request content '.repeat(1000);
  example.definition.question = { kind: 'provider' };
  example.input = { messages: [{ role: 'user', content }] };
  const config = inferenceConfiguration(
    {
      id: 'key',
      organizationId: 'tenant',
      role: 'owner',
      kind: 'api_key',
      scopes: [],
      workspaceIds: [],
      operator: false,
    },
    example,
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Fixture model',
      provider: 'anthropic',
      harnesses: [],
      enabled: true,
      input_micro_usd_per_million: '1000000',
      output_micro_usd_per_million: '5000000',
    },
  );
  const stringify = vi.spyOn(JSON, 'stringify');
  try {
    const prepared = prepareInvocation(config);
    expect(prepared.ciphertext).not.toBe('');
    expect(stringify.mock.calls.filter(([value]) => value === content)).toHaveLength(1);
  } finally {
    stringify.mockRestore();
  }
});
