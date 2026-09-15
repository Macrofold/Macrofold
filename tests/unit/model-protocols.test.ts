import { it, expect } from 'vitest';
import { modelProtocol } from '../../packages/providers/src/model-protocols';
import { emptyUsage } from '../../packages/core/src/model-protocol';
const bounds = { maxOutput: 100, inputMicroUsdPerMillion: '1000000', outputMicroUsdPerMillion: '2000000' };
it('normalizes Anthropic partial frames without double counting cached inputs', () => {
  const protocol = modelProtocol('anthropic')!;
  const first = protocol.usage(
    {
      type: 'message_start',
      message: { usage: { input_tokens: 3, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 } },
    },
    emptyUsage(),
  );
  expect(first).toMatchObject({ input: 18, cached: 10, cacheWrite: 5, complete: false });
  const second = protocol.usage({ type: 'message_delta', usage: { output_tokens: 7 } }, first);
  expect(second).toMatchObject({ input: 18, output: 7, cached: 10, cacheWrite: 5 });
  expect(protocol.usage({ type: 'message_stop' }, second)).toMatchObject({ input: 18, complete: true });
});
it('owns wire-specific headers, tool gates and output bounds without billing authority', () => {
  const payload = { messages: [], tools: [], max_tokens: 4 };
  modelProtocol('anthropic')!.prepare(payload, 'v1/messages/count_tokens', bounds);
  expect(payload.max_tokens).toBe(4);
  modelProtocol('anthropic')!.prepare(payload, 'v1/messages', bounds);
  expect(payload.max_tokens).toBe(100);
  expect(() =>
    modelProtocol('openai')!.prepare({ tools: [{ type: 'web_search' }] }, 'v1/responses', bounds),
  ).toThrow();
  expect(modelProtocol('unknown')).toBeUndefined();
  expect(modelProtocol('openai')!.headers('fixture', new Headers())).toEqual({
    Authorization: 'Bearer fixture',
    'Content-Type': 'application/json',
  });
});
