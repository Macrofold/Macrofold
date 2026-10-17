import { afterEach, expect, it, vi } from 'vitest';
import type { DispatchClass } from '../../packages/core/src/capacity';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  advance: vi.fn(),
  candidates: vi.fn(),
  claim: vi.fn(),
  failed: vi.fn(),
  succeeded: vi.fn(),
}));
vi.mock('../../packages/db', () => ({ pool: { query: mocks.query } }));
vi.mock('../../packages/core/src/cloud-engine', () => ({ advanceCloudRun: mocks.advance }));
vi.mock('../../packages/core/src/scheduling', () => ({
  pendingRunCandidates: mocks.candidates,
  orderDispatchJobs: (jobs: unknown[]) => jobs,
}));
vi.mock('../../packages/core/src/engine', () => ({ claimRun: mocks.claim }));
vi.mock('../../packages/core/src/dispatch-failures', () => ({
  dispatchFailed: mocks.failed,
  dispatchSucceeded: mocks.succeeded,
}));
import { CloudDispatcher } from '../../packages/core/src/portable-dispatch';
import { FaultMachine } from '../fixtures/cloud-machine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

function fixture(ids = ['one']) {
  const due = [...ids];
  mocks.candidates.mockResolvedValue([]);
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.startsWith('WITH due')) {
      const resource = args[4] as DispatchClass;
      return {
        rows:
          resource === 'control' && due.length
            ? [{ id: due[0], organization_id: 'org', resource_id: due.shift(), state: 'running' }]
            : [],
      };
    }
    if (sql.startsWith('UPDATE dispatch_jobs SET available_at')) due.push(String(args[0]));
    return { rows: [] };
  });
  return new CloudDispatcher(new FaultMachine(), { inference: 1, provision: 1, transfer: 1, control: 1 });
}
const ready = { done: false, delaySeconds: 0, nextDispatchClass: 'control', canContinue: true } as const;

it('retains a ready same-class slot for at most sixteen advances, then lets another job compete', async () => {
  const dispatcher = fixture(['one', 'two']);
  mocks.advance.mockImplementation(async (_org: string, run: string) =>
    run === 'one' ? ready : { ...ready, done: true },
  );
  await dispatcher.tick();
  await dispatcher.drain();
  expect(mocks.advance).toHaveBeenCalledTimes(16);
  expect(mocks.candidates).toHaveBeenCalledTimes(2);
  expect(mocks.query.mock.calls.filter(([sql]) => String(sql).startsWith('WITH due'))).toHaveLength(4);
  expect(mocks.succeeded).not.toHaveBeenCalled(); // Native phase commits own this reset.
  await dispatcher.tick();
  await dispatcher.drain();
  expect(mocks.advance.mock.calls.at(-1)?.[1]).toBe('two');
  expect(mocks.claim).not.toHaveBeenCalled(); // No new admission bypasses the fair queue.
});

it.each([
  { ...ready, nextDispatchClass: 'transfer' },
  { ...ready, delaySeconds: 2 },
  { ...ready, queued: true },
  { ...ready, done: true },
  { ...ready, canContinue: false },
])('yields for a resource change, real wait, queue, terminal state or quiet probe: %j', async (result) => {
  const dispatcher = fixture();
  mocks.advance.mockResolvedValue(result);
  await dispatcher.tick();
  await dispatcher.drain();
  expect(mocks.advance).toHaveBeenCalledOnce();
});

it('starts no further phase after five seconds of ready work', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const dispatcher = fixture();
  mocks.advance.mockImplementation(async () => {
    now += 2500;
    return ready;
  });
  await dispatcher.tick();
  await dispatcher.drain();
  expect(mocks.advance).toHaveBeenCalledTimes(2);
});
