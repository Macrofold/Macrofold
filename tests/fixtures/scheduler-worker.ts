import { pool, authPool, credentialPool } from '../../packages/db';
import { config, isLocal } from '../../packages/core/src/config';
import { executeRun, pendingRuns } from '../../packages/core/src/engine';
import type { ExecutionProvider } from '../../packages/providers/src/execution';
import { LocalDispatcher } from '../../packages/core/src/local-dispatch';

if (!isLocal() || config.allowPaid || config.execution !== 'simulator')
  throw new Error('Unpaid local simulation required.');
let closing = false;
let released = false;
process.on('message', (message) => {
  if ((message as { type?: string }).type === 'release') released = true;
});
process.on('SIGTERM', () => {
  closing = true;
});
const provider: ExecutionProvider = {
  async execute(request, onEvent) {
    process.send?.({
      type: 'started',
      run: request.runId,
      organization: request.organizationId,
      pid: process.pid,
    });
    const duration = JSON.parse(request.prompt).duration as number;
    const until = Date.now() + duration;
    while ((duration < 0 && !released) || Date.now() < until) {
      if (request.signal.aborted) throw request.signal.reason;
      await new Promise((r) => setTimeout(r, 30));
    }
    await onEvent({
      type: 'output.delta',
      data: { text: 'Local load simulation completed.', simulated: true },
    });
    return {
      output: 'Local load simulation completed.',
      files: request.files,
      inputTokens: 0,
      outputTokens: 0,
      usageComplete: true,
    };
  },
};
const dispatcher = new LocalDispatcher(provider, () => {
  process.send?.({ type: 'error', message: 'Local dispatch failed' });
});
process.send?.({ type: 'ready', pid: process.pid });
while (!closing) {
  if (process.env.LOAD_DISPATCH_MODE === 'batch') {
    // The original local worker waits for an entire execution batch before polling.
    await Promise.all(
      (await pendingRuns()).map((j) => executeRun(j.organization_id, j.resource_id, provider)),
    );
  } else {
    await dispatcher.tick();
  }
  await new Promise((r) => setTimeout(r, 50));
}
await dispatcher.drain();
await pool.end();
await authPool.end();
await credentialPool.end();
// The load harness owns this IPC channel; close it after graceful draining so
// a message listener does not keep an otherwise stopped worker process alive.
process.disconnect?.();
