import { afterEach, expect, it, vi } from 'vitest';
import { MaintenanceDispatcher } from '../../packages/core/src/maintenance-dispatch';
import { runPollerLoop } from '../../packages/core/src/poller-loop';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
afterEach(() => {
  vi.restoreAllMocks();
});

it('keeps polling during slow maintenance, never overlaps sweeps, and drains both on shutdown', async () => {
  const maintenance = barrier(),
    execution = barrier(),
    drained = barrier();
  let closing = false,
    finished = false;
  const maintain = vi.fn(() => maintenance.promise);
  const dispatcher = {
    tick: vi.fn(async () => {
      if (dispatcher.tick.mock.calls.length === 4) closing = true;
    }),
    waitForProgress: async () => {},
    drain: vi.fn(() => {
      drained.release();
      return execution.promise;
    }),
  };
  const loop = runPollerLoop(
    dispatcher,
    new MaintenanceDispatcher([
      {
        name: 'test',
        run: async () => {
          await maintain();
          return {};
        },
      },
    ]),
    () => closing,
  ).then(() => {
    finished = true;
  });
  try {
    await drained.promise;
    expect(dispatcher.tick).toHaveBeenCalledTimes(4);
    expect(maintain).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    execution.release();
    await execution.promise;
    expect(finished).toBe(false);
  } finally {
    maintenance.release();
    execution.release();
    await loop;
  }
  expect(finished).toBe(true);
});

it('contains maintenance and dispatch failures and continues the loop without logging raw errors', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  let closing = false;
  const dispatcher = {
    tick: vi.fn(async () => {
      if (dispatcher.tick.mock.calls.length === 1) throw Error('private provider error');
      closing = true;
    }),
    waitForProgress: async () => {},
    drain: vi.fn(async () => {}),
  };
  await runPollerLoop(
    dispatcher,
    new MaintenanceDispatcher([
      {
        name: 'test',
        run: async () => {
          throw Error('private maintenance error');
        },
      },
    ]),
    () => closing,
  );
  expect(dispatcher.tick).toHaveBeenCalledTimes(2);
  expect(dispatcher.drain).toHaveBeenCalledOnce();
  expect(error.mock.calls.flat().join(' ')).not.toContain('private');
  expect(error).toHaveBeenCalledTimes(2);
});

it('waits fifteen seconds after a sweep completes before starting another', async () => {
  let now = 1000,
    closing = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const maintain = vi.fn(async () => {});
  let ticks = 0;
  await runPollerLoop(
    {
      tick: async () => {
        ticks++;
      },
      waitForProgress: async () => {
        if (ticks === 1) await new Promise(setImmediate); // Complete the sweep before advancing its clock.
        if (ticks === 2) now = 15999;
        if (ticks === 3) {
          expect(maintain).toHaveBeenCalledTimes(1);
          now = 16000;
        }
        if (ticks === 4) closing = true;
      },
      drain: async () => {},
    },
    new MaintenanceDispatcher([
      {
        name: 'test',
        run: async () => {
          await maintain();
          return {};
        },
      },
    ]),
    () => closing,
  );
  expect(maintain).toHaveBeenCalledTimes(2);
});

it('runs another component again while slow maintenance is still in flight', async () => {
  const slow = barrier();
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const exportTask = vi.fn(async () => {
    await slow.promise;
    return {};
  });
  const reconcile = vi.fn(async () => ({}));
  const dispatcher = new MaintenanceDispatcher([
    { name: 'export', run: exportTask },
    { name: 'workers', run: reconcile, intervalMs: 2000 },
  ]);
  try {
    await dispatcher.tick();
    await new Promise(setImmediate);
    expect(reconcile).toHaveBeenCalledOnce();
    now = 3000;
    await dispatcher.tick();
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2));
    expect(exportTask).toHaveBeenCalledOnce();
  } finally {
    slow.release();
    await dispatcher.drain();
  }
});
