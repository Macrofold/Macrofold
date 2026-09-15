import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { harnesses, harnessNames, harnessLabel } from '../../packages/contracts/harnesses';
import { deepseekEvent } from '../../packages/runtime/src/deepseek-events';
import { DeepSeekAdapter } from '../../packages/runtime/src/deepseek';
import { PiAdapter } from '../../packages/runtime/src/pi';
import type { HarnessContext } from '../../packages/runtime/src/types';
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it('keeps all public request/response harness enums aligned with dashboard and runtime discovery', async () => {
  const spec = JSON.parse(await readFile('docs/api/openapi.json', 'utf8'));
  let count = 0;
  function check(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if ('enum' in value && Array.isArray(value.enum) && value.enum.includes('codex')) {
      expect(value.enum).toEqual(harnessNames);
      count++;
    }
    for (const child of Object.values(value)) check(child);
  }
  check(spec);
  expect(count).toBeGreaterThanOrEqual(5);
  expect(harnesses.map((h) => h.id)).toEqual(harnessNames);
  expect(harnessLabel('deepseek')).toBe('DeepSeek Harness');
  expect(harnessLabel('pi')).toBe('Pi');
  expect(harnessLabel('unknown')).toBe('unknown');
});

const event = (type: string, data: unknown) =>
  deepseekEvent({ type, data } as Parameters<typeof deepseekEvent>[0]);
it('normalizes DeepSeek assistant text without including reasoning or tool blocks', () => {
  expect(
    event('assistant/message', {
      message: {
        content: [
          { type: 'reasoning', text: 'Private reasoning' },
          { type: 'text', text: 'Hello ' },
          { type: 'tool-call', arguments: 'secret tool arguments' },
          { type: 'text', text: 'world' },
        ],
      },
    }),
  ).toEqual({ type: 'output.delta', data: { text: 'Hello world' } });
  expect(
    event('assistant/message', { message: { content: [{ type: 'reasoning', text: 'Private' }] } }),
  ).toBeUndefined();
  expect(event('turn/end', { reason: { kind: 'error' } })).toBeUndefined();
});
it('preserves DeepSeek tool identity and failure independently of text streaming', () => {
  expect(event('tool/call', { callId: 'call', name: 'bash', arguments: '{"command":"false"}' })).toEqual({
    type: 'tool.started',
    data: { tool_call_id: 'call', name: 'bash', arguments: '{"command":"false"}' },
  });
  expect(
    event('tool/result', {
      message: { content: [{ toolCallId: 'call', content: 'Denied', isError: true }] },
    }),
  ).toEqual({
    type: 'tool.completed',
    data: { tool_call_id: 'call', result: 'Denied', is_error: true },
  });
});
it.each([
  ['pi', new PiAdapter()],
  ['deepseek', new DeepSeekAdapter()],
] as const)(
  '%s refuses a missing continuation instead of executing a fresh prompt',
  async (harness, adapter) => {
    const home = await mkdtemp(path.join(tmpdir(), 'harness-fixture-'));
    temporary.push(home);
    const context: HarnessContext = {
      configuration: {
        harness,
        runId: 'fixture',
        model: 'fixture',
        provider: 'openai',
        prompt: 'Must not run',
        workspace: '/workspace',
        stateHome: home,
        gatewayURL: 'http://127.0.0.1:1',
        toolURL: 'http://127.0.0.1:1',
        token: 'synthetic',
        toolGrants: false,
        deadline: new Date(Date.now() + 60000).toISOString(),
        resumeId: '../escape',
      },
      signal: new AbortController().signal,
      emit: async () => {
        throw new Error('Unexpected native execution');
      },
      ask: async () => {
        throw new Error('Unexpected native execution');
      },
    };
    await expect(adapter.run(context)).rejects.toThrow(/Invalid .* session/);
    context.configuration.resumeId = harness === 'pi' ? 'missing.jsonl' : `session-${'a'.repeat(32)}`;
    // The requested checkpoint cannot resolve, even if a caller bypassed public admission.
    await expect(adapter.run(context)).rejects.toThrow();
  },
);
