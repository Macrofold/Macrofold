import { setTimeout as pause } from 'node:timers/promises';
import { errorDiagnostics } from './error-diagnostics';
import type { PollerWakeup } from './poller-wakeup';

type Dispatcher = {
  tick(): Promise<void>;
  drain(): Promise<void>;
  waitForProgress?(signal?: AbortSignal): Promise<void>;
};

/** Process lifetime only. SQL and the dispatcher retain execution/retry policy. */
export async function runPollerLoop(
  dispatcher: Dispatcher,
  maintenance: Pick<Dispatcher, 'tick' | 'drain'>,
  closing: () => boolean,
  wakeup?: PollerWakeup,
) {
  try {
    while (!closing()) {
      const generation = wakeup?.generation;
      await maintenance.tick();
      try {
        await dispatcher.tick();
      } catch (error) {
        console.error(JSON.stringify({ code: 'run_dispatch_unavailable', ...errorDiagnostics(error) }));
      }
      if (closing()) break;
      if (wakeup && generation !== undefined) {
        const controller = new AbortController();
        const signal = controller.signal;
        const progress = dispatcher.waitForProgress
          ? dispatcher.waitForProgress(signal)
          : pause(750, undefined, { signal }).catch((error: unknown) => {
              if (!signal.aborted) throw error;
            });
        try {
          await Promise.race([progress, wakeup.wait(generation, signal)]);
        } finally {
          controller.abort();
        }
      } else if (dispatcher.waitForProgress) await dispatcher.waitForProgress();
      else await pause(750);
    }
  } finally {
    // Closing pools/exporters before these settle would interrupt durable work.
    await Promise.allSettled([dispatcher.drain(), maintenance.drain()]);
  }
}
