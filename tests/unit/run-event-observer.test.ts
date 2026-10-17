import { afterEach, expect, it, vi } from 'vitest';
import { RunEventObserver } from '../../packages/core/src/run-event-observer';
afterEach(() => vi.useRealTimers());

it('shares one current-state page for multiple readers and keeps organizations separate', async () => {
  vi.useFakeTimers();
  const read = vi.fn(async (_org: string, runs: string[]) =>
    runs.map((id) => ({ id, event_sequence: '1', status: 'running', failure_code: null })),
  );
  const observer = new RunEventObserver(read);
  const a = observer.subscribe('one', 'run'),
    b = observer.subscribe('one', 'run'),
    c = observer.subscribe('two', 'run');
  await vi.advanceTimersByTimeAsync(100);
  expect(read.mock.calls).toEqual([
    ['one', ['run']],
    ['two', ['run']],
  ]);
  const waitA = a.wait(a.version()),
    waitB = b.wait(b.version());
  observer.hint('one', 'run');
  await expect(waitA).resolves.toBe('changed');
  await expect(waitB).resolves.toBe('changed');
  expect(c.version()).toBe(1);
  a.dispose();
  b.dispose();
  c.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('repairs a missed wake and reports the final durable sequence', async () => {
  vi.useFakeTimers();
  let sequence = '1',
    status = 'running';
  const observer = new RunEventObserver(async (_org, runs) =>
    runs.map((id) => ({ id, event_sequence: sequence, status, failure_code: null })),
  );
  const reader = observer.subscribe('org', 'run');
  await vi.advanceTimersByTimeAsync(100);
  const wait = reader.wait(reader.version());
  sequence = '3';
  status = 'succeeded';
  await vi.advanceTimersByTimeAsync(200);
  await expect(wait).resolves.toBe('changed');
  expect(reader.state()).toEqual({ sequence: '3', terminal: true });
  reader.dispose();
});

it('shares one optional listener, repairs missed notifications and closes it when idle', async () => {
  vi.useFakeTimers();
  let notify: ((org: string, run: string) => void) | undefined;
  const close = vi.fn();
  const listen = vi.fn((hint: typeof notify) => {
    notify = hint;
    return { connected: () => true, close };
  });
  const read = vi.fn(async (_org: string, runs: string[]) =>
    runs.map((id) => ({ id, event_sequence: '1', status: 'running', failure_code: null })),
  );
  const observer = new RunEventObserver(read, listen);
  const first = observer.subscribe('org', 'run'),
    second = observer.subscribe('org', 'run');
  await vi.advanceTimersByTimeAsync(100);
  expect(listen).toHaveBeenCalledTimes(1);
  const wait = second.wait(second.version());
  notify?.('other', 'run');
  expect(second.version()).toBe(1);
  notify?.('org', 'run');
  await expect(wait).resolves.toBe('changed');
  await vi.advanceTimersByTimeAsync(900);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(50);
  expect(read).toHaveBeenCalledTimes(2);
  first.dispose();
  expect(close).not.toHaveBeenCalled();
  second.dispose();
  expect(close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('closes readers after missing state, SQL failure, cancellation and shared lifetime expiry', async () => {
  vi.useFakeTimers();
  const missing = new RunEventObserver(async () => []);
  const first = missing.subscribe('org', 'missing');
  const wait = first.wait(first.version());
  await vi.advanceTimersByTimeAsync(100);
  await expect(wait).resolves.toBe('closed');
  first.dispose();
  const failed = new RunEventObserver(async () => {
    throw new Error('offline');
  });
  const second = failed.subscribe('org', 'run');
  const failure = second.wait(second.version());
  await vi.advanceTimersByTimeAsync(100);
  await expect(failure).resolves.toBe('closed');
  second.dispose();
  const observer = new RunEventObserver(async (_org, runs) =>
    runs.map((id) => ({ id, event_sequence: '0', status: 'running', failure_code: null })),
  );
  const reader = observer.subscribe('org', 'run');
  await vi.advanceTimersByTimeAsync(100);
  await vi.advanceTimersByTimeAsync(55_000);
  await expect(reader.wait(reader.version())).resolves.toBe('closed');
  reader.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
