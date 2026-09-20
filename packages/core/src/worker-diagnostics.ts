import { randomUUID } from 'node:crypto';

const workerId = `${process.pid}:${randomUUID()}`;
type Fields = {
  organization_id?: string;
  run_id?: string;
  request_id?: string;
  model?: string;
  provider?: string;
  done?: boolean;
  queued?: boolean;
  delay_seconds?: number;
};

/** Opt-in, content-free progress independent of Langfuse and database availability.
 * In-progress events identify a hung await; they never cancel or retry its work. */
export async function observeWorkerStep<T>(
  stage: string,
  fields: Fields,
  action: () => Promise<T>,
): Promise<T> {
  if (process.env.WORKER_DIAGNOSTICS !== '1') return action();
  const started = performance.now();
  const operationId = randomUUID();
  const write = (state: 'started' | 'waiting' | 'completed' | 'failed') => {
    try {
      console.info(JSON.stringify({
        component: 'worker', observation: `worker.${stage}.${state}`,
        timestamp: new Date().toISOString(), worker_id: workerId,
        operation_id: operationId, duration_ms: Math.round(performance.now() - started),
        ...fields,
      }));
    } catch {
      // Diagnostics cannot change execution or expose raw exceptions/content.
    }
  };
  write('started');
  const timer = setInterval(() => write('waiting'), 5000);
  timer.unref();
  try {
    const result = await action();
    write('completed');
    return result;
  } catch (error) {
    write('failed');
    throw error;
  } finally {
    clearInterval(timer);
  }
}
