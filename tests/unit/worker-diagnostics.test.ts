import { afterEach, expect, it, vi } from 'vitest';
import { observeWorkerStep } from '../../packages/core/src/worker-diagnostics';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('does not log when disabled and preserves the action result', async () => {
  vi.stubEnv('WORKER_DIAGNOSTICS', '0');
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  expect(await observeWorkerStep('launch', { run_id: 'fixture-run' }, async () => 42)).toBe(42);
  expect(log).not.toHaveBeenCalled();
});

it('correlates waiting and completion without logging the action output or leaking a timer', async () => {
  vi.stubEnv('WORKER_DIAGNOSTICS', '1');
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  let release!: (value: string) => void;
  const result = observeWorkerStep(
    'restore',
    { run_id: 'fixture-run', organization_id: 'fixture-org' },
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  await vi.advanceTimersByTimeAsync(5000);
  release('private action output');
  expect(await result).toBe('private action output');
  const events = log.mock.calls.map(([line]) => JSON.parse(line));
  expect(events.map((event) => event.observation)).toEqual([
    'worker.restore.started',
    'worker.restore.waiting',
    'worker.restore.completed',
  ]);
  expect(new Set(events.map((event) => event.operation_id)).size).toBe(1);
  expect(
    events.every((event) => event.run_id === 'fixture-run' && event.organization_id === 'fixture-org'),
  ).toBe(true);
  expect(JSON.stringify(events)).not.toContain('private action output');
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves action errors without exposing their content and clears progress timers', async () => {
  vi.stubEnv('WORKER_DIAGNOSTICS', '1');
  vi.useFakeTimers();
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const failure = new Error('private provider response');
  await expect(
    observeWorkerStep('launch', {}, async () => {
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(log.mock.calls.map(([line]) => JSON.parse(line).observation)).toEqual([
    'worker.launch.started',
    'worker.launch.failed',
  ]);
  expect(JSON.stringify(log.mock.calls)).not.toContain(failure.message);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not let a logging failure change execution success', async () => {
  vi.stubEnv('WORKER_DIAGNOSTICS', '1');
  vi.spyOn(console, 'info').mockImplementation(() => {
    throw new Error('logging unavailable');
  });
  expect(await observeWorkerStep('launch', {}, async () => 'accepted')).toBe('accepted');
});
