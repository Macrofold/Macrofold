import { dispatchMaintenance } from '../packages/core/src/git-jobs';
import { LocalDispatcher } from '../packages/core/src/local-dispatch';
import { dispatchCloudPoller } from '../packages/core/src/portable-dispatch';
import { machines } from '../packages/providers/src/machines';
import { config, isLocal, isSimulated, assertSecurityConfiguration } from '../packages/core/src/config';
import { pool, authPool, credentialPool } from '../packages/db';
import { shutdownTracing } from '../packages/core/src/tracing';
assertSecurityConfiguration();
if (!isLocal() && (config.execution !== 'vercel' || config.orchestration !== 'poller'))
  throw new Error(
    'The standalone worker requires EXECUTION_PROVIDER=vercel and ORCHESTRATION_BACKEND=poller in production.',
  );
let closing = false,
  maintenanceAt = 0;
const local = new LocalDispatcher();
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
while (!closing) {
  let ready = false;
  if (Date.now() >= maintenanceAt) {
    try {
      await dispatchMaintenance();
    } catch {
      console.error('Maintenance sweep failed; pending work remains durable.');
    }
    maintenanceAt = Date.now() + 15000;
  }
  try {
    if (isSimulated()) {
      await local.tick();
    } else {
      const result = await dispatchCloudPoller(machines, Number(process.env.WORKER_CONCURRENCY || 4));
      ready = result.ready;
      if (result.failed) console.error('A cloud step failed; durable retry is scheduled.');
    }
  } catch {
    console.error('Run dispatch is temporarily unavailable.');
  }
  // Revisit ready work immediately while yielding for signals and other I/O.
  // Empty queues, actual polling and failures keep the ordinary idle cadence.
  await new Promise((resolve) => setTimeout(resolve, ready ? 0 : 750));
}
await local.drain();
await shutdownTracing();
await pool.end();
await authPool.end();
await credentialPool.end();
