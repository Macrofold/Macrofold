import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  pending: vi.fn(),
  start: vi.fn(),
  failed: vi.fn(),
  succeeded: vi.fn(),
}));
vi.mock('../../packages/db', () => ({ pool: { query: mocks.query } }));
vi.mock('../../packages/core/src/engine', () => ({ startRun: mocks.start, pendingRuns: mocks.pending }));
vi.mock('../../packages/core/src/dispatch-failures', () => ({
  dispatchFailed: mocks.failed,
  dispatchSucceeded: mocks.succeeded,
}));
vi.mock('../../packages/core/src/capacity', () => ({
  dispatchLimits: () => ({ inference: 2, control: 1 }),
}));
import { LocalDispatcher } from '../../packages/core/src/local-dispatch';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const row = (id: string, kind = 'inference') => ({ organization_id: 'org', resource_id: id, kind });

it('starts the next native admission before a queued inference burst and drains both admission and execution', async () => {
  const first = barrier(),
    execution = barrier(),
    entered = barrier();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.pending.mockImplementation(async (_limit: number, kind: string) =>
    kind === 'inference' ? [row('inference-one'), row('inference-two')] : [row('native', 'native_agent')],
  );
  mocks.start.mockImplementation(async (_org: string, run: string) => {
    if (run === 'inference-one') {
      entered.release();
      await first.promise;
    }
    return { completion: execution.promise };
  });
  const dispatcher = new LocalDispatcher();
  await dispatcher.tick();
  await entered.promise;
  expect(mocks.start.mock.calls.map((call) => call[1])).toEqual(['inference-one']);
  let drained = false;
  const draining = dispatcher.drain().then(() => {
    drained = true;
  });
  try {
    first.release();
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(3));
    expect(mocks.start.mock.calls.map((call) => call[1])).toEqual([
      'inference-one',
      'native',
      'inference-two',
    ]);
    expect(drained).toBe(false);
    expect(mocks.succeeded).not.toHaveBeenCalled();
  } finally {
    first.release();
    execution.release();
    await draining;
  }
  expect(drained).toBe(true);
  expect(mocks.succeeded).toHaveBeenCalledTimes(3);
});

it('reserves queued admissions against class caps and excludes them from later overlapping ticks', async () => {
  const admission = barrier(),
    execution = barrier();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.pending.mockImplementation(async (_limit: number, kind: string) =>
    kind === 'inference'
      ? [row('one'), row('two'), row('three')]
      : [row('native-one', 'native_agent'), row('native-two', 'native_agent')],
  );
  mocks.start.mockImplementation(async () => {
    await admission.promise;
    return { completion: execution.promise };
  });
  const dispatcher = new LocalDispatcher();
  await dispatcher.tick();
  await dispatcher.tick();
  try {
    expect(mocks.start).toHaveBeenCalledOnce();
    admission.release();
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(3));
    expect(mocks.start.mock.calls.map((call) => call[1])).toEqual(['one', 'native-one', 'two']);
    await dispatcher.tick();
    expect(mocks.start).toHaveBeenCalledTimes(3);
  } finally {
    admission.release();
    execution.release();
    await dispatcher.drain();
  }
});

it('advances already-running inference without waiting for another queued admission', async () => {
  const admission = barrier(),
    execution = barrier(),
    recovery = barrier();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.pending.mockImplementation(async (_limit: number, kind: string) =>
    kind === 'inference' ? [row('queued')] : [],
  );
  mocks.start.mockImplementation(async (_org: string, run: string) => {
    if (run === 'queued') await admission.promise;
    else recovery.release();
    return { completion: execution.promise };
  });
  const dispatcher = new LocalDispatcher();
  await dispatcher.tick();
  mocks.query.mockResolvedValue({ rows: [row('recovered', 'bounded_agent')] });
  try {
    await dispatcher.tick();
    await recovery.promise;
    expect(mocks.start.mock.calls.map((call) => call[1])).toEqual(['queued', 'recovered']);
  } finally {
    admission.release();
    execution.release();
    await dispatcher.drain();
  }
});

it('records an admission failure without poisoning the next execution class', async () => {
  const error = new Error('synthetic admission error'),
    onError = vi.fn();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.pending.mockImplementation(async (_limit: number, kind: string) =>
    kind === 'inference' ? [row('failed')] : [row('native', 'native_agent')],
  );
  mocks.start.mockImplementation(async (_org: string, run: string) => {
    if (run === 'failed') throw error;
    return { completion: Promise.resolve() };
  });
  const dispatcher = new LocalDispatcher(undefined, onError);
  await dispatcher.tick();
  await dispatcher.drain();
  expect(mocks.failed).toHaveBeenCalledExactlyOnceWith('org', 'run', 'failed', 'local_dispatch_failed');
  expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(mocks.succeeded).toHaveBeenCalledExactlyOnceWith('org', 'run', 'native');
});
