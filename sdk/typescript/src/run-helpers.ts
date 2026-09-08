import type { Schema } from './client.js';

export class RunFailedError extends Error {
  constructor(
    readonly runId: string,
    readonly status: string,
    readonly result: Schema['RunResult'],
    readonly failureCode?: string,
  ) {
    super(`Run ${runId} ended with status ${status} (persistence: ${result.persistence_status}).`);
    this.name = 'RunFailedError';
  }
}
export class WaitTimeoutError extends Error {
  constructor(readonly runId: string) {
    super(`Timed out waiting for run ${runId}. The agent has not been cancelled.`);
    this.name = 'WaitTimeoutError';
  }
}
export type WaitOptions = { timeoutMs?: number; pollIntervalMs?: number; signal?: AbortSignal };
type Runs = {
  get(id: string, options?: { signal?: AbortSignal }): Promise<Schema['Run']>;
  getResult(id: string, options?: { signal?: AbortSignal }): Promise<Schema['RunResult']>;
};
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'timed_out']);

export async function waitForRun(runs: Runs, runId: string, options: WaitOptions = {}) {
  const interval = options.pollIntervalMs ?? 1000;
  if (!Number.isFinite(interval) || interval <= 0) throw new RangeError('pollIntervalMs must be positive');
  if (
    options.timeoutMs !== undefined &&
    (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 0 || options.timeoutMs > 2_147_483_647)
  )
    throw new RangeError('timeoutMs must be between 0 and 2147483647');
  const timeout = new AbortController();
  const failure = new WaitTimeoutError(runId);
  const timer =
    options.timeoutMs === undefined ? undefined : setTimeout(() => timeout.abort(failure), options.timeoutMs);
  if (options.timeoutMs === 0) timeout.abort(failure);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal;
  try {
    for (;;) {
      signal.throwIfAborted();
      const run = await runs.get(runId, { signal });
      if (terminal.has(run.status)) {
        const result = await runs.getResult(runId, { signal });
        signal.throwIfAborted();
        if (result.final && result.persistence_status !== 'pending') {
          if (
            run.status !== 'succeeded' ||
            result.execution_outcome !== 'success' ||
            !['verified', 'not_required'].includes(result.persistence_status)
          )
            throw new RunFailedError(runId, run.status, result, run.failure_code);
          return result;
        }
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(poll);
          reject(signal.reason);
        };
        const poll = setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve();
        }, interval);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function* streamRunText(
  events: AsyncGenerator<Schema['Event']>,
  complete: () => Promise<Schema['RunResult']>,
): AsyncGenerator<string> {
  // for-await closes the source on detachment; completion is checked only after normal EOF.
  for await (const event of events) {
    if (event.type === 'output.delta' && typeof event.data.text === 'string' && event.data.text)
      yield event.data.text;
  }
  await complete();
}
