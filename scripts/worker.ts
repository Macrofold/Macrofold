import { maintenanceTasks } from '../packages/core/src/git-jobs';
import { MaintenanceDispatcher } from '../packages/core/src/maintenance-dispatch';
import { WorkerDispatcher } from '../packages/core/src/worker-reconciler';
import { LocalDispatcher } from '../packages/core/src/local-dispatch';
import { CloudDispatcher } from '../packages/core/src/portable-dispatch';
import { machines } from '../packages/providers/src/machines';
import { config, isLocal, isSimulated, assertSecurityConfiguration } from '../packages/core/src/config';
import { pool, authPool, credentialPool } from '../packages/db';
import { shutdownTracing } from '../packages/core/src/tracing';
import { observeWorkerStep } from '../packages/core/src/worker-diagnostics';
import { runPollerLoop } from '../packages/core/src/poller-loop';
import { initializePerformance } from '../packages/core/src/performance-composition';
import { shutdownPerformance } from '../packages/core/src/performance';
assertSecurityConfiguration();
initializePerformance();
if (!isLocal() && (config.execution !== 'vercel' || config.orchestration !== 'poller'))
  throw new Error(
    'The standalone worker requires EXECUTION_PROVIDER=vercel and ORCHESTRATION_BACKEND=poller in production.',
  );
let closing = false;
const dispatcher = isSimulated() ? new LocalDispatcher() : new CloudDispatcher(machines);
const workers = new WorkerDispatcher();
const maintenance = new MaintenanceDispatcher(
  maintenanceTasks().map((task) =>
    task.name === 'workers'
      ? { ...task, run: () => workers.tick(), drain: () => workers.drain(), intervalMs: 250 }
      : task,
  ),
);
process.on('SIGINT', () => {
  closing = true;
});
process.on('SIGTERM', () => {
  closing = true;
});
console.log(
  isSimulated()
    ? 'Worker ready: local simulation, no paid API calls.'
    : `Worker ready: durable ${config.execution} poller. Paid execution remains controlled by ALLOW_PAID_EXECUTION.`,
);
await runPollerLoop(
  {
    tick: () => observeWorkerStep('dispatch', {}, () => dispatcher.tick()),
    drain: () => dispatcher.drain(),
    ...(dispatcher instanceof CloudDispatcher ? { waitForProgress: () => dispatcher.waitForProgress() } : {}),
  },
  maintenance,
  () => closing,
);
await shutdownTracing();
await shutdownPerformance();
await pool.end();
await authPool.end();
await credentialPool.end();
