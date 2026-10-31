/** Coalesced hints, including those arriving during a scan. SQL remains the
 * authority; the generation only prevents sleeping through a committed change. */
export class PollerWakeup {
  private revision = 0;
  private readonly waiting = new Set<() => void>();
  get generation() {
    return this.revision;
  }
  notify() {
    this.revision++;
    for (const wake of this.waiting) wake();
  }
  wait(generation: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted || generation !== this.revision) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.waiting.delete(done);
        signal.removeEventListener('abort', done);
        resolve();
      };
      this.waiting.add(done);
      signal.addEventListener('abort', done, { once: true });
    });
  }
}
