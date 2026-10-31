import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { FaultMachine } from './cloud-machine';
import type { MachineBinding } from '../../packages/core/src/ports';
import type { NativeConfiguration } from '../../packages/runtime/src/types';
import { sha256 } from '../../packages/core/src/crypto';
import type { PerformanceRecord } from '../../packages/contracts/performance';

// A frozen source tree is used only by the explicit matched qualification.
// Every process still uses the disposable database and scripted machine port.
const baseline = process.env.NATIVE_SCHEDULING_BASELINE_ROOT;
const source = (path: string) =>
  baseline ? pathToFileURL(resolve(baseline, path)).href : new URL('../../' + path, import.meta.url).href;
const database: typeof import('../../packages/db') = await import(source('packages/db/index.ts'));
const settings: typeof import('../../packages/core/src/config') = await import(
  source('packages/core/src/config.ts')
);
if (
  !process.send ||
  !settings.isLocal() ||
  settings.config.allowPaid ||
  settings.config.execution !== 'simulator' ||
  !new URL(settings.config.databaseUrl).pathname.startsWith('/platform_test_')
)
  throw new Error('Native scheduling qualification requires an isolated unpaid fixture.');
globalThis.fetch = async () => {
  throw new Error('Unexpected HTTP request from the scripted native scheduling worker.');
};

const { CloudDispatcher }: typeof import('../../packages/core/src/portable-dispatch') = await import(
  source('packages/core/src/portable-dispatch.ts')
);
const { runPollerLoop }: typeof import('../../packages/core/src/poller-loop') = await import(
  source('packages/core/src/poller-loop.ts')
);
const performanceModule: typeof import('../../packages/core/src/performance') = await import(
  source('packages/core/src/performance.ts')
);
const diagnostics: typeof import('../../packages/db/diagnostics') = await import(
  source('packages/db/diagnostics.ts')
);
const { observeWorkerStep }: typeof import('../../packages/core/src/worker-diagnostics') = await import(
  source('packages/core/src/worker-diagnostics.ts')
);
let statements = 0,
  unattributedStatements = 0,
  groups = 0,
  commits = 0,
  sqlMs = 0;
const slowOperations: PerformanceRecord[] = [];
const capture = performanceModule.configurePerformance({
  sampleRate: 1,
  durationSeconds: 3600,
  sink: {
    enqueue(record) {
      if (record.type !== 'operation') return;
      // Retain existing, content-free records without hot-path IPC. A fixed cap
      // keeps tail diagnostics bounded even when a stressed cohort is slow.
      if (record.run_id && record.duration_ms >= 80 && slowOperations.length < 64)
        slowOperations.push(record);
      statements += record.counters.statements ?? 0;
      groups += record.counters.groups ?? 0;
      commits += record.counters.commits ?? 0;
      sqlMs += record.stages['db.query']?.total_ms ?? 0;
    },
    flush: async () => {},
    close: async () => {},
  },
});
capture.onClose(
  diagnostics.observeDatabasePools(
    [
      [database.pool, 'domain'],
      [database.authPool, 'identity'],
      [database.credentialPool, 'credential'],
    ],
    performanceModule.capturePerformanceTicket,
    (kind, pool) => {
      if (kind === 'query') unattributedStatements++;
      capture.unattributed(kind, pool);
    },
  ),
);

let heldRestore = false;
let releaseRestore = () => {};
class ObservedMachine extends FaultMachine {
  override async provision(name: string) {
    process.send?.({ type: 'provision', run_id: name.slice(4), at: Date.now() });
    return super.provision(name);
  }
  override async prepare(_binding?: MachineBinding, configuration?: NativeConfiguration) {
    if (!configuration) throw new Error('The native fixture configuration is missing.');
    process.send?.({
      type: 'prepared',
      run_id: configuration.runId,
      prompt_bytes: Buffer.byteLength(configuration.prompt),
      prompt_sha256: sha256(configuration.prompt),
    });
    return super.prepare();
  }
  override async close(binding: MachineBinding, preserve: boolean) {
    const result = await super.close(binding, preserve);
    process.send?.({ type: 'closed', run_id: binding.name.slice(4), at: Date.now() });
    return result;
  }
  override async restore() {
    if (process.env.NATIVE_SCHEDULING_HOLD_RESTORE === '1' && !heldRestore) {
      heldRestore = true;
      process.send?.({ type: 'restore_waiting' });
      await new Promise<void>((resolve) => {
        releaseRestore = resolve;
      });
    }
    return super.restore();
  }
}
const machines = new Map<string, ObservedMachine>();
const dispatcher = new CloudDispatcher((run) => {
  let machine = machines.get(run.id);
  if (!machine) {
    machine = new ObservedMachine();
    machines.set(run.id, machine);
  }
  return machine;
});
let closing = false;
const maintenance = { tick: async () => {}, drain: async () => {} };
// The baseline intentionally has no wake listener; its periodic poller is the
// measured previous implementation, not a manually advanced Run.
const wakeModule = baseline ? undefined : await import('../../packages/core/src/poller-wakeup');
const wakeup = wakeModule ? new wakeModule.PollerWakeup() : undefined;
const wakeListener = wakeup
  ? (await import('../../packages/db/dispatch-wakeup')).listenDispatchWakeup(() => wakeup.notify())
  : undefined;
if (wakeListener) {
  const deadline = Date.now() + 5000;
  while (!wakeListener.connected()) {
    if (Date.now() >= deadline) throw new Error('Fixture dispatch listener did not connect.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
let ready = false;
process.on('message', (message: unknown) => {
  if (!message || typeof message !== 'object' || !('type' in message)) return;
  if (message.type === 'release') releaseRestore();
  if (message.type === 'metrics') {
    process.send?.({
      type: 'metrics',
      statements: statements + unattributedStatements,
      unattributed_statements: unattributedStatements,
      groups,
      commits,
      sql_ms: sqlMs,
      slow_operations: slowOperations,
      launches: [...machines.values()].reduce((total, machine) => total + machine.starts, 0),
      pid: process.pid,
      node: process.version,
    });
  }
});
process.once('SIGTERM', () => {
  closing = true;
  releaseRestore();
  wakeup?.notify();
});
try {
  await runPollerLoop(
    {
      tick: () => observeWorkerStep('dispatch', {}, () => dispatcher.tick()),
      drain: () => dispatcher.drain(),
      waitForProgress: async (signal?: AbortSignal) => {
        if (!ready) {
          ready = true;
          process.send?.({ type: 'ready', pid: process.pid });
        }
        process.send?.({ type: 'idle', at: Date.now() });
        await dispatcher.waitForProgress(750, signal);
      },
    },
    maintenance,
    () => closing,
    wakeup,
  );
} finally {
  await wakeListener?.close();
  await capture.close();
  await Promise.all([database.pool.end(), database.authPool.end(), database.credentialPool.end()]);
  process.disconnect?.();
}
