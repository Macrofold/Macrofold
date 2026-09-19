/** One pending turn at a time. The supervisor serializes admission; this is an
 * SDK input stream, not another execution queue. */
export class TurnInput<T> implements AsyncIterableIterator<T> {
  private value?: T;
  private waiting?: (result: IteratorResult<T>) => void;
  private closed = false;
  push(value: T) {
    if (this.closed || this.value !== undefined) throw new Error('Native input is unavailable');
    if (this.waiting) {
      const receive = this.waiting;
      this.waiting = undefined;
      receive({ value, done: false });
    } else this.value = value;
  }
  next(): Promise<IteratorResult<T>> {
    if (this.value !== undefined) {
      const value = this.value;
      this.value = undefined;
      return Promise.resolve({ value, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }
  close() {
    this.closed = true;
    this.value = undefined;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}
