import { afterEach, expect, it, vi } from 'vitest';
import { createOpencodeServer } from '@opencode-ai/sdk/v2/server';
import { OpenCodeAdapter } from '../../packages/runtime/src/opencode';
import type { NativeConfiguration } from '../../packages/runtime/src/types';

vi.mock('@opencode-ai/sdk/v2/server', () => ({ createOpencodeServer: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
it.each([60_000, 2_000])(
  'bounds server startup by the execution deadline (%i ms remaining)',
  async (remaining) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const abort = new AbortController();
    vi.mocked(createOpencodeServer).mockImplementation(async (options) => {
      expect(options?.timeout).toBeLessThanOrEqual(remaining);
      if (remaining > 5_000) expect(options?.timeout).toBeGreaterThan(5_000);
      expect(options?.signal).toBe(abort.signal);
      return new Promise((_, reject) =>
        options!.signal!.addEventListener('abort', () => reject(new Error('fixture cancelled')), {
          once: true,
        }),
      );
    });
    const configuration: NativeConfiguration = {
      runId: 'fixture',
      harness: 'opencode',
      model: 'fixture-model',
      provider: 'openai',
      prompt: 'Never executed',
      workspace: '/workspace',
      stateHome: '/agent-home',
      gatewayURL: 'http://127.0.0.1:1',
      toolURL: 'http://127.0.0.1:1',
      token: 'fixture',
      deadline: new Date(Date.now() + remaining).toISOString(),
      toolGrants: false,
    };
    const emit = vi.fn();
    const execution = new OpenCodeAdapter().run({ configuration, signal: abort.signal, emit, ask: vi.fn() });
    const result = expect(execution).rejects.toThrow('fixture cancelled');
    abort.abort();
    await result;
    expect(emit).not.toHaveBeenCalled();
  },
);
