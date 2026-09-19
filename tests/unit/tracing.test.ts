import { afterEach, expect, it, vi } from 'vitest';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { LangfuseTraceSink, traceIdentity } from '../../packages/providers/src/langfuse';
import { traceContent } from '../../packages/providers/src/trace-content';
import { ModelOutputCapture } from '../../packages/providers/src/model-output-capture';
import type { TraceObservation } from '../../packages/core/src/trace';

const observation: TraceObservation = {
  id: 'call-1',
  name: 'decision.generate',
  type: 'generation',
  context: {
    organization_id: 'org',
    workspace_id: 'workspace',
    worktree_id: 'worktree',
    session_id: 'session',
    run_id: 'run',
    user_id: 'owner',
    customer_id: 'customer',
    customer_binding_id: 'binding',
    agent_key: 'assistant',
    run_kind: 'inference',
    model: 'typesafe/jev-1.13',
    provider: 'openrouter',
    billing_mode: 'managed',
  },
  startedAt: new Date('2026-09-19T00:00:00Z'),
  endedAt: new Date('2026-09-19T00:00:01Z'),
  input: { prompt: 'Synthetic choice' },
  output: { value: 'review' },
  model: 'typesafe/jev-1.13',
  chargedMicroUsd: '31',
  usage: { input: 100, output: 10, cached: 20, cacheWrite: 10, complete: true },
  metadata: { provider_cost_micro_usd: '29', provisional: false },
};
afterEach(() => vi.restoreAllMocks());

it('uses official SDK mapping, stable tenant-separated IDs and query dimensions on every span', async () => {
  const exporter = new InMemorySpanExporter();
  const sink = new LangfuseTraceSink({ exporter });
  sink.record(observation);
  sink.record({ ...observation, id: 'run', type: 'agent', chargedMicroUsd: undefined, usage: undefined });
  await sink.flush();
  const [generation, root] = exporter.getFinishedSpans();
  expect(generation.spanContext()).toMatchObject(traceIdentity('org', 'run', 'call-1'));
  expect(generation.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
  expect(root.parentSpanContext).toBeUndefined();
  expect(root.attributes['langfuse.internal.is_app_root']).toBe(true);
  expect(generation.attributes['langfuse.internal.is_app_root']).not.toBe(true);
  expect(root.resource.attributes['service.name']).toBe('platform.execution');
  expect(traceIdentity('another-org', 'run')).not.toEqual(traceIdentity('org', 'run'));
  for (const span of [generation, root]) {
    expect(span.attributes['langfuse.trace.metadata.workspace_id']).toBe('workspace');
    expect(span.attributes['langfuse.trace.metadata.worktree_id']).toBe('worktree');
    expect(span.attributes['langfuse.trace.metadata.customer_id']).toBe('customer');
    expect(span.attributes['langfuse.user.id']).toBe('org:owner:customer');
    expect(span.attributes['langfuse.session.id']).toBe('org:session');
    expect(span.attributes['langfuse.trace.tags']).toContain('provider:openrouter');
  }
  expect(generation.attributes['langfuse.observation.type']).toBe('generation');
  expect(JSON.parse(String(generation.attributes['langfuse.observation.usage_details']))).toEqual({
    input: 70,
    output: 10,
    input_cached: 20,
    input_cache_write: 10,
  });
  expect(JSON.parse(String(generation.attributes['langfuse.observation.cost_details']))).toEqual({
    total: 0.000031,
  });
  expect(root.attributes['langfuse.observation.cost_details']).toBeUndefined();
  expect(JSON.parse(String(generation.attributes['langfuse.observation.input']))).toEqual(observation.input);
  await sink.shutdown();
});
it('omits incomplete usage rather than inventing zero tokens and supports content opt-out', async () => {
  const exporter = new InMemorySpanExporter();
  const sink = new LangfuseTraceSink({ exporter, capture: false });
  sink.record({
    ...observation,
    level: 'ERROR',
    usage: { ...observation.usage!, complete: false },
    chargedMicroUsd: '0',
  });
  await sink.flush();
  const [span] = exporter.getFinishedSpans();
  expect(span.attributes['langfuse.observation.usage_details']).toBeUndefined();
  expect(String(span.attributes['langfuse.observation.input'])).toContain('content_capture_disabled');
  expect(span.status.code).toBe(2);
  await sink.shutdown();
});
it('bounds outstanding traces and reports export failures without leaking error details', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const sink = new LangfuseTraceSink({
    exporter: {
      export: (_spans, callback) => callback({ code: 1, error: new Error('secret payload') }),
      shutdown: async () => {},
    },
  });
  for (let i = 0; i < 65; i++) sink.record({ ...observation, id: `call-${i}` });
  await sink.flush().catch(() => {});
  expect(warn.mock.calls.flat().join(' ')).toContain('trace_queue_full');
  expect(warn.mock.calls.flat().join(' ')).toContain('trace_export_failed');
  expect(warn.mock.calls.flat().join(' ')).not.toContain('secret payload');
  await sink.shutdown();
});
it('redacts credential fields, known tokens, signed URLs and media without altering ordinary text', () => {
  const value = traceContent(
    {
      text: 'Hello',
      nested: { api_key: 'secret', access_token: 'secret' },
      prompt: 'Bearer sensitive-value',
      url: 'https://files.test/a?X-Amz-Signature=secret',
      image: 'data:image/png;base64,AAAA',
      thinking: 'private',
      input_tokens: 42,
    },
    1024,
  );
  expect(value).toMatchObject({
    text: 'Hello',
    nested: { api_key: '[redacted]', access_token: '[redacted]' },
    prompt: '[redacted]',
    url: 'https://files.test/a?[redacted]',
    image: { omitted: 'inline_media' },
    thinking: '[redacted]',
    input_tokens: 42,
  });
  expect(traceContent('a'.repeat(100), 10)).toMatchObject({ truncated: true, original_bytes: 102 });
  expect(traceContent(undefined, 10)).toBeUndefined();
});
it('captures fragmented provider text and tool frames, prefers completed Responses and bounds partial output', () => {
  const chat = new ModelOutputCapture();
  chat.add({ choices: [{ delta: { content: 'Hello ' } }] });
  chat.add({ choices: [{ delta: { content: 'there', tool_calls: [{ name: 'read' }] } }] });
  expect(chat.result()).toMatchObject({ text: 'Hello there', truncated: false });
  expect(chat.firstOutputAt).toBeInstanceOf(Date);
  const anthropic = new ModelOutputCapture();
  anthropic.add({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } });
  expect(anthropic.result()).toMatchObject({ text: 'answer' });
  anthropic.add({ type: 'response.completed', response: { id: 'resp', output: [{ text: 'complete' }] } });
  expect(anthropic.result()).toEqual({ id: 'resp', output: [{ text: 'complete' }] });
  const bounded = new ModelOutputCapture(10);
  bounded.add({ type: 'response.output_text.delta', delta: 'too much' });
  expect(bounded.result()).toMatchObject({ truncated: true });
});
