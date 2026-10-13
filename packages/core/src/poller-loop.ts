type Dispatcher = {
  tick(): Promise<void>;
  drain(): Promise<void>;
  waitForProgress?(): Promise<void>;
};

/** Process lifetime only. SQL and the dispatcher retain execution/retry policy. */
export async function runPollerLoop(
  dispatcher: Dispatcher,
  maintenance: Pick<Dispatcher, 'tick' | 'drain'>,
  closing: () => boolean,
) {
  try {
    while (!closing()) {
      await maintenance.tick();
      try {
        await dispatcher.tick();
      } catch {
        console.error('Run dispatch is temporarily unavailable.');
      }
      if (dispatcher.waitForProgress) await dispatcher.waitForProgress();
      else await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } finally {
    // Closing pools/exporters before these settle would interrupt durable work.
    await Promise.allSettled([dispatcher.drain(), maintenance.drain()]);
  }
}
