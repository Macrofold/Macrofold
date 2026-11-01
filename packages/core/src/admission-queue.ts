import type { ExecutionClass } from './scheduling';

/** Short SQL admissions stay serialized, with FIFO heads alternating between
 * execution classes. Callers bound the queue with their owned active slots;
 * model/provider execution never holds this turn. */
export class FairAdmissionQueue {
  private readonly waiting: Record<ExecutionClass, Set<() => Promise<void>>> = {
    native: new Set(),
    inference: new Set(),
  };
  private busy = false;
  private previous: ExecutionClass = 'inference';

  run<T>(resource: ExecutionClass, action: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting[resource].add(async () => {
        try {
          resolve(await action());
        } catch (error) {
          reject(error);
        }
      });
      this.pump();
    });
  }

  private pump() {
    if (this.busy) return;
    const opposite = this.previous === 'native' ? 'inference' : 'native';
    const resource = this.waiting[opposite].size ? opposite : this.previous;
    const next = this.waiting[resource].values().next().value;
    if (!next) return;
    this.waiting[resource].delete(next);
    this.busy = true;
    this.previous = resource;
    const finished = () => {
      this.busy = false;
      this.pump();
    };
    // Each action settles its caller's result/error. Either way, the next head
    // must progress; a failed admission is not a poisoned promise chain.
    next().then(finished, finished);
  }
}
