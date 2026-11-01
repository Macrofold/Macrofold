import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DatabaseError } from 'pg';
import type { DispatchClass } from '../../packages/core/src/capacity';
import type { CloudRunContext, advanceCloudRun } from '../../packages/core/src/cloud-engine';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  advance: vi.fn(),
  candidates: vi.fn(),
  claim: vi.fn(),
  failed: vi.fn(),
  succeeded: vi.fn(),
  observed: vi.fn(),
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
vi.mock('../../packages/core/src/worker-diagnostics', () => ({
  observeWorkerStep: (stage: string, fields: object, action: () => Promise<unknown>) => {
    mocks.observed(stage, fields);
    return action();
  },
}));
import { CloudDispatcher, dispatchCloudPoller } from '../../packages/core/src/portable-dispatch';
import { FaultMachine } from '../fixtures/cloud-machine';

beforeEach(() => {
  mocks.claim.mockImplementation(async (org: string, run: string) => ({
    id: run,
    organization_id: org,
    kind: 'native_agent',
  }));
});

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
type Advance = Awaited<ReturnType<typeof advanceCloudRun>>;
function nativeResult(result: Advance, context?: CloudRunContext) {
  if (
    result.canContinue &&
    !result.done &&
    !result.queued &&
    result.delaySeconds === 0 &&
    result.nextDispatchClass
  )
    context?.retainReady?.(result.nextDispatchClass);
  return result;
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('retains a ready same-class slot for at most sixteen advances, then lets another job compete', async () => {
  const dispatcher = fixture(['one', 'two']);
  mocks.advance.mockImplementation(
    async (_org: string, run: string, _provider: unknown, context: CloudRunContext) =>
      nativeResult(run === 'one' ? ready : { ...ready, done: true }, context),
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
  { ...ready, delaySeconds: 2 },
  { ...ready, queued: true },
  { ...ready, done: true },
  { ...ready, canContinue: false },
])('yields for a real wait, queue, terminal state or quiet probe: %j', async (result) => {
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
  mocks.advance.mockImplementation(
    async (_org: string, _run: string, _provider: unknown, context: CloudRunContext) => {
      now += 2500;
      return nativeResult(ready, context);
    },
  );
  await dispatcher.tick();
  await dispatcher.drain();
  expect(mocks.advance).toHaveBeenCalledTimes(2);
});

it('honors a retained slot if its publication crosses the time quantum', async () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const dispatcher = fixture();
  mocks.advance.mockImplementation(
    async (_org: string, _run: string, _provider: unknown, context: CloudRunContext) => {
      const result = nativeResult(ready, context);
      // The engine already published a retained recovery deadline before this
      // simulated slow commit completed. The next step must explicitly yield it.
      now = 6000;
      return result;
    },
  );
  await dispatcher.tick();
  await dispatcher.drain();
  expect(mocks.advance).toHaveBeenCalledTimes(2);
});

it('hands a ready admitted Run between free pools without another claim or resetting its quantum', async () => {
  const dispatcher = fixture();
  let advances = 0;
  mocks.advance.mockImplementation(
    async (_org: string, _run: string, _provider: unknown, context: CloudRunContext) => {
      advances++;
      return nativeResult({ ...ready, nextDispatchClass: advances % 2 ? 'transfer' : 'control' }, context);
    },
  );
  await dispatcher.tick();
  await dispatcher.drain();
  expect(advances).toBe(16);
  expect(mocks.query.mock.calls.filter(([sql]) => String(sql).startsWith('WITH due'))).toHaveLength(4);
  expect(
    mocks.query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE dispatch_jobs')),
  ).toHaveLength(0);
  expect(mocks.claim).not.toHaveBeenCalled();
  const contexts = mocks.advance.mock.calls.map((call) => call[3]);
  expect(contexts.every((context) => context === contexts[0])).toBe(true);
});

it('yields to durable dispatch when the target pool is occupied', async () => {
  const dispatcher = fixture();
  const occupied = barrier();
  const entered = barrier();
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => ({
    rows:
      sql.startsWith('WITH due') && ['control', 'transfer'].includes(String(args[4]))
        ? [{ id: args[4], organization_id: 'org', resource_id: args[4], state: 'running' }]
        : [],
  }));
  mocks.advance.mockImplementation(
    async (_org: string, run: string, _provider: unknown, context: CloudRunContext) => {
      if (run === 'transfer') {
        await occupied.promise;
        return { ...ready, done: true };
      }
      entered.release();
      return nativeResult({ ...ready, nextDispatchClass: 'transfer' }, context);
    },
  );
  try {
    await dispatcher.tick();
    await entered.promise;
    expect(mocks.advance.mock.calls.filter((call) => call[1] === 'control')).toHaveLength(1);
    expect(mocks.claim).not.toHaveBeenCalled();
  } finally {
    occupied.release();
    await dispatcher.drain();
  }
});

it('does not consume a target slot reserved by an in-flight SQL claim', async () => {
  const dispatcher = fixture();
  const query = barrier(),
    started = barrier();
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (!sql.startsWith('WITH due')) return { rows: [] };
    if (args[4] === 'transfer') await query.promise;
    return {
      rows:
        args[4] === 'control'
          ? [{ id: 'one', organization_id: 'org', resource_id: 'one', state: 'running' }]
          : [],
    };
  });
  mocks.advance.mockImplementation(
    async (_org: string, _run: string, _provider: unknown, context: CloudRunContext) => {
      started.release();
      return nativeResult({ ...ready, nextDispatchClass: 'transfer' }, context);
    },
  );
  const ticking = dispatcher.tick();
  try {
    await started.promise;
    expect(mocks.advance).toHaveBeenCalledOnce();
  } finally {
    query.release();
    await ticking;
    await dispatcher.drain();
  }
});

it.each(['candidates', 'claim'] as const)(
  'starts native progress before a slow inference %s query returns',
  async (stage) => {
    const dispatcher = fixture();
    const held = barrier(),
      started = barrier();
    if (stage === 'candidates')
      mocks.candidates.mockImplementation(async (_limit: number, kind: string) => {
        if (kind === 'inference') await held.promise;
        return [];
      });
    else {
      const query = mocks.query.getMockImplementation();
      if (!query) throw new Error('Expected the query fixture.');
      mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
        if (sql.startsWith('WITH due') && args[4] === 'inference') await held.promise;
        return query(sql, args);
      });
    }
    mocks.advance.mockImplementation(async () => {
      started.release();
      return { ...ready, done: true };
    });
    let released = false;
    const ticking = dispatcher.tick();
    try {
      await started.promise;
      expect(released).toBe(false);
      expect(mocks.advance).toHaveBeenCalledOnce();
    } finally {
      released = true;
      held.release();
      await ticking;
      await dispatcher.drain();
    }
  },
);

it('refills several native quanta while an inference discovery remains blocked', async () => {
  const dispatcher = fixture(['first', 'second', 'third']);
  const held = barrier();
  let inferenceFinished = false;
  mocks.candidates.mockImplementation(async (_limit: number, resource: string) => {
    if (resource === 'inference') {
      await held.promise;
      inferenceFinished = true;
    }
    return [];
  });
  mocks.advance.mockImplementation(
    async (_org: string, run: string, _provider: unknown, context: CloudRunContext) =>
      nativeResult(run === 'third' ? { ...ready, done: true } : ready, context),
  );
  const ticks = [dispatcher.tick()];
  try {
    await vi.waitFor(
      () => {
        ticks.push(dispatcher.tick());
        expect(mocks.advance.mock.calls.some((call) => call[1] === 'third')).toBe(true);
      },
      { timeout: 500, interval: 5 },
    );
    expect(inferenceFinished).toBe(false);
    expect(mocks.candidates.mock.calls.filter((call) => call[1] === 'inference')).toHaveLength(1);
    expect(mocks.advance.mock.calls.filter((call) => call[1] === 'first')).toHaveLength(16);
    expect(mocks.advance.mock.calls.filter((call) => call[1] === 'second')).toHaveLength(16);
  } finally {
    held.release();
    await Promise.all(ticks);
    await dispatcher.drain();
  }
});

it('advances running native phases without waiting for queued native eligibility', async () => {
  const dispatcher = fixture();
  const held = barrier(),
    started = barrier();
  let candidateFinished = false;
  mocks.candidates.mockImplementation(async (_limit: number, resource: string) => {
    if (resource === 'native') {
      await held.promise;
      candidateFinished = true;
    }
    return [];
  });
  mocks.advance.mockImplementation(async () => {
    started.release();
    return { ...ready, done: true };
  });
  await dispatcher.tick();
  try {
    await started.promise;
    expect(candidateFinished).toBe(false);
    expect(mocks.advance).toHaveBeenCalledOnce();
  } finally {
    held.release();
    await dispatcher.drain();
  }
});

it('rescans fresh eligibility after a wake arrives during an old candidate snapshot', async () => {
  mocks.query.mockResolvedValue({ rows: [] });
  const dispatcher = new CloudDispatcher(new FaultMachine(), {
    inference: 1,
    provision: 1,
    transfer: 1,
    control: 1,
  });
  const held = barrier(),
    entered = barrier(),
    admitted = barrier();
  let nativeScans = 0,
    claimed = false;
  mocks.candidates.mockImplementation(async (_limit: number, resource: string) => {
    if (resource === 'inference') return [];
    if (++nativeScans === 1) {
      entered.release();
      await held.promise;
      return [];
    }
    return [{ resource_id: 'fresh', organization_id: 'org', kind: 'native_agent' }];
  });
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
    const eligible = Array.isArray(args[2]) && args[2].includes('fresh');
    if (sql.startsWith('WITH due') && args[4] === 'provision' && eligible && !claimed) {
      claimed = true;
      return { rows: [{ id: 'fresh', resource_id: 'fresh', organization_id: 'org', state: 'pending' }] };
    }
    return { rows: [] };
  });
  mocks.advance.mockImplementation(async () => {
    admitted.release();
    return { ...ready, done: true };
  });
  await dispatcher.tick();
  try {
    await entered.promise;
    await dispatcher.tick(); // A newly committed Run woke the poller during its old read.
    held.release();
    await admitted.promise; // No third tick is needed to observe fresh eligibility.
    expect(nativeScans).toBeGreaterThan(1);
    expect(mocks.claim).toHaveBeenCalledWith('org', 'fresh');
  } finally {
    held.release();
    await dispatcher.drain();
  }
});

it('does not treat empty discovery completion as progress or busy-poll', async () => {
  vi.useFakeTimers();
  try {
    const dispatcher = fixture([]);
    await dispatcher.tick();
    await dispatcher.drain();
    let completed = false;
    const waiting = dispatcher.waitForProgress(750).then(() => {
      completed = true;
    });
    await vi.advanceTimersByTimeAsync(749);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).startsWith('WITH due'))).toHaveLength(4);
  } finally {
    vi.useRealTimers();
  }
});

it('serializes pending admissions in candidate order while already-running work advances', async () => {
  mocks.candidates.mockResolvedValue([]);
  const admission = barrier(),
    entered = barrier(),
    running = barrier();
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => ({
    rows: !sql.startsWith('WITH due')
      ? []
      : args[4] === 'provision'
        ? ['first', 'second'].map((id) => ({ id, organization_id: 'org', resource_id: id, state: 'pending' }))
        : args[4] === 'control'
          ? [{ id: 'running', organization_id: 'org', resource_id: 'running', state: 'running' }]
          : [],
  }));
  // Two free provisioning slots permit both claims, but only one admission at a time.
  const wider = new CloudDispatcher(new FaultMachine(), {
    inference: 1,
    provision: 2,
    transfer: 1,
    control: 1,
  });
  mocks.claim.mockImplementation(async (_org: string, run: string) => {
    if (run === 'first') {
      entered.release();
      await admission.promise;
    }
  });
  mocks.advance.mockImplementation(async (_org: string, run: string) => {
    if (run === 'running') running.release();
    return { ...ready, done: true };
  });
  const ticking = wider.tick();
  try {
    await Promise.all([entered.promise, running.promise]);
    expect(mocks.claim.mock.calls.map((call) => call[1])).toEqual(['first']);
  } finally {
    admission.release();
    await ticking;
    await wider.drain();
  }
  expect(mocks.claim.mock.calls.map((call) => call[1])).toEqual(['first', 'second']);
});

it.each([false, true])(
  'reuses the confirmed native admission row for its first phase (bounded sweep: %s)',
  async (bounded) => {
    mocks.candidates.mockResolvedValue([]);
    const admitted = { id: 'first', organization_id: 'org', kind: 'native_agent' };
    mocks.claim.mockResolvedValue(admitted);
    mocks.query.mockImplementation(async (sql: string, args: unknown[]) => ({
      rows:
        sql.startsWith('WITH due') && (args[4] == null || args[4] === 'provision')
          ? [{ id: 'first', organization_id: 'org', resource_id: 'first', state: 'pending' }]
          : [],
    }));
    mocks.advance.mockResolvedValue({ ...ready, done: true });
    if (bounded) await dispatchCloudPoller(new FaultMachine(), 1);
    else {
      const dispatcher = new CloudDispatcher(new FaultMachine(), 1);
      await dispatcher.tick();
      await dispatcher.drain();
    }
    expect(mocks.advance).toHaveBeenCalledOnce();
    expect(mocks.advance.mock.calls[0][3]?.run).toBe(admitted);
    expect(mocks.observed).toHaveBeenCalledWith('admission', { organization_id: 'org', run_id: 'first' });
  },
);

it.each([{ kind: 'inference', id: 'first', organization_id: 'org' }])(
  'does not seed native prepared state from a non-native admission: %j',
  async (admitted) => {
    mocks.candidates.mockResolvedValue([]);
    mocks.claim.mockResolvedValue(admitted);
    mocks.query.mockImplementation(async (sql: string, args: unknown[]) => ({
      rows:
        sql.startsWith('WITH due') && args[4] === 'provision'
          ? [{ id: 'first', organization_id: 'org', resource_id: 'first', state: 'pending' }]
          : [],
    }));
    mocks.advance.mockResolvedValue({ ...ready, done: true });
    const dispatcher = new CloudDispatcher(new FaultMachine(), 1);
    await dispatcher.tick();
    await dispatcher.drain();
    expect(mocks.advance).toHaveBeenCalledOnce();
    expect(mocks.advance.mock.calls[0][3]?.run).toBeUndefined();
  },
);

it('releases only its exact pending claim without a second admission or overriding another owner', async () => {
  const dispatcher = fixture([]),
    lease = '2026-10-31T12:00:05.123456Z';
  mocks.claim.mockResolvedValue(null);
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => ({
    rows:
      sql.startsWith('WITH due') && args[4] === 'provision'
        ? [
            {
              id: 'job',
              resource_id: 'first',
              organization_id: 'org',
              state: 'pending',
              claimed_lease_until: lease,
            },
          ]
        : [],
  }));
  await dispatcher.tick();
  await dispatcher.drain();
  expect(mocks.claim).toHaveBeenCalledExactlyOnceWith('org', 'first');
  expect(mocks.advance).not.toHaveBeenCalled();
  expect(mocks.succeeded).not.toHaveBeenCalled();
  expect(mocks.failed).not.toHaveBeenCalled();
  const updates = mocks.query.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE dispatch_jobs'));
  expect(updates).toEqual([
    [
      "UPDATE dispatch_jobs SET lease_until=NULL WHERE id=$1 AND state='pending' AND lease_until=$2::timestamptz",
      ['job', lease],
    ],
  ]);
});

it('does not wake an extra refill wave just because work started', async () => {
  const dispatcher = fixture(),
    entered = barrier(),
    phase = barrier();
  mocks.advance.mockImplementation(async () => {
    entered.release();
    await phase.promise;
    return { ...ready, done: true };
  });
  await dispatcher.tick();
  await entered.promise;
  vi.useFakeTimers();
  let completed = false;
  const waiting = dispatcher.waitForProgress().then(() => {
    completed = true;
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(completed).toBe(false);
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).startsWith('WITH due'))).toHaveLength(4);
    phase.release();
    await waiting;
    expect(completed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    phase.release();
    await dispatcher.drain();
    vi.useRealTimers();
  }
});

it('gives a queued native head the next SQL turn before the rest of an inference burst', async () => {
  const dispatcher = new CloudDispatcher(new FaultMachine(), {
    inference: 2,
    provision: 1,
    transfer: 1,
    control: 1,
  });
  const first = barrier(),
    entered = barrier();
  mocks.candidates.mockResolvedValue([]);
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => ({
    rows: !sql.startsWith('WITH due')
      ? []
      : args[4] === 'inference'
        ? ['inference-one', 'inference-two'].map((id) => ({
            id,
            resource_id: id,
            organization_id: 'org',
            state: 'pending',
          }))
        : args[4] === 'provision'
          ? [{ id: 'native', resource_id: 'native', organization_id: 'org', state: 'pending' }]
          : [],
  }));
  mocks.claim.mockImplementation(async (_org: string, run: string) => {
    if (run === 'inference-one') {
      entered.release();
      await first.promise;
    }
    return { id: run, organization_id: 'org', kind: run === 'native' ? 'native_agent' : 'inference' };
  });
  mocks.advance.mockResolvedValue({ ...ready, done: true });
  await dispatcher.tick();
  try {
    await entered.promise;
    // All discovery promises are already resolved; flush their queued microtasks
    // before releasing the first SQL turn, without relying on elapsed time.
    await new Promise(setImmediate);
    expect(mocks.claim.mock.calls.map((call) => call[1])).toEqual(['inference-one']);
    first.release();
    await dispatcher.drain();
    expect(mocks.claim.mock.calls.map((call) => call[1])).toEqual([
      'inference-one',
      'native',
      'inference-two',
    ]);
  } finally {
    first.release();
    await dispatcher.drain();
  }
});

it.each(['candidates', 'admission', 'advance'] as const)(
  'retains safe SQL diagnostics for a failed %s without logging content',
  async (stage) => {
    const dispatcher = fixture(stage === 'advance' ? ['one'] : []);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new DatabaseError('private SQL/provider content', 0, 'error');
    error.code = '53300';
    if (stage === 'candidates') mocks.candidates.mockRejectedValueOnce(error);
    else if (stage === 'advance') mocks.advance.mockRejectedValue(error);
    else {
      mocks.claim.mockRejectedValue(error);
      mocks.query.mockImplementation(async (sql: string, args: unknown[]) => ({
        rows:
          sql.startsWith('WITH due') && args[4] === 'provision'
            ? [{ id: 'one', resource_id: 'one', organization_id: 'org', state: 'pending' }]
            : [],
      }));
    }
    await dispatcher.tick();
    await dispatcher.drain();
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      code: stage === 'candidates' ? 'run_dispatch_unavailable' : 'poller_advance_failed',
      sqlstate: '53300',
    });
    expect(log.mock.calls.flat().join(' ')).not.toContain('private');
  },
);

it('interrupts an idle wait without leaking its timer or abort listener', async () => {
  vi.useFakeTimers();
  try {
    const dispatcher = fixture();
    const wake = new AbortController();
    const removed = vi.spyOn(wake.signal, 'removeEventListener');
    const waiting = dispatcher.waitForProgress(750, wake.signal);
    expect(vi.getTimerCount()).toBe(1);
    wake.abort();
    await waiting;
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    await dispatcher.waitForProgress(750, wake.signal);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('cleans up a wake listener when execution progress wins the wait', async () => {
  const dispatcher = fixture();
  const phase = barrier();
  mocks.advance.mockImplementation(async () => {
    await phase.promise;
    return { ...ready, done: true };
  });
  await dispatcher.tick();
  vi.useFakeTimers();
  try {
    const wake = new AbortController();
    const removed = vi.spyOn(wake.signal, 'removeEventListener');
    const waiting = dispatcher.waitForProgress(750, wake.signal);
    expect(vi.getTimerCount()).toBe(1);
    phase.release();
    await waiting;
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  } finally {
    phase.release();
    await dispatcher.drain();
    vi.useRealTimers();
  }
});
