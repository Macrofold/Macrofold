import { describe, expect, it } from 'vitest';
import { warmSessionKey } from '../../packages/runtime/src/warm-session';
import { TurnInput } from '../../packages/runtime/src/turn-input';
import type { NativeConfiguration } from '../../packages/runtime/src/types';
const configuration: NativeConfiguration = {
  runId: 'first',
  harness: 'codex',
  provider: 'openai',
  model: 'fixture',
  prompt: 'first prompt',
  workspace: '/workspace',
  stateHome: '/agent-home',
  gatewayURL: 'http://fixture/first/model',
  toolURL: 'http://fixture/first/mcp',
  token: 'first-capability',
  deadline: '2026-09-19T00:00:00Z',
  toolGrants: false,
  warm: { sessionId: 'session', checkpointId: 'checkpoint', toolFingerprint: 'none' },
};
describe('resident conversation compatibility', () => {
  it('allows a new turn and credential without changing session identity', () => {
    expect(
      warmSessionKey({
        ...configuration,
        runId: 'second',
        prompt: 'follow up',
        token: 'second-capability',
        deadline: '2026-09-20T00:00:00Z',
      }),
    ).toBe(warmSessionKey(configuration));
    expect(warmSessionKey({ ...configuration, warm: undefined })).toBeUndefined();
  });
  it.each([
    { model: 'another-model' },
    { harness: 'pi' as const },
    { provider: 'openrouter' },
    { instructions: 'new policy' },
    { warm: { ...configuration.warm!, sessionId: 'another-session' } },
    { warm: { ...configuration.warm!, toolFingerprint: 'changed-grants' } },
    { permissions: [{ version: 1 as const, files: { write: { exclude: ['private/**'] } } }] },
  ])('invalidates an incompatible native configuration %j', (change) => {
    expect(warmSessionKey({ ...configuration, ...change })).not.toBe(warmSessionKey(configuration));
  });
});
it('delivers turns before or after the SDK waits, and closes a waiting stream', async () => {
  const input = new TurnInput<string>();
  input.push('first');
  expect(await input.next()).toEqual({ value: 'first', done: false });
  const waiting = input.next();
  input.push('second');
  expect(await waiting).toEqual({ value: 'second', done: false });
  const ended = input.next();
  input.close();
  expect(await ended).toEqual({ done: true, value: undefined });
  expect(() => input.push('too late')).toThrow();
});
