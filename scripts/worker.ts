import { dispatchMaintenance } from '../packages/core/src/git-jobs';
import { LocalDispatcher } from '../packages/core/src/local-dispatch';
import { dispatchCloudPoller } from '../packages/core/src/portable-dispatch';
import { machines } from '../packages/providers/src/machines';
import { config, isLocal, assertSecurityConfiguration } from '../packages/core/src/config';
import { pool, authPool, credentialPool } from '../packages/db';
assertSecurityConfiguration();
if (!isLocal() && (config.execution !== 'vercel' || config.orchestration !== 'poller'))
  throw new Error(
    'The standalone worker requires EXECUTION_PROVIDER=vercel and ORCHESTRATION_BACKEND=poller in production.',
  );
if (isLocal() && config.execution !== 'simulator')
  throw new Error('Local worker acceptance uses simulator execution only.');
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
  isLocal()
    ? 'Worker ready: local simulation, no paid API calls.'
    : 'Worker ready: durable cloud poller. Paid execution remains controlled by ALLOW_PAID_EXECUTION.',
);
while (!closing) {
  if (Date.now() >= maintenanceAt) {
    try {
      await dispatchMaintenance();
    } catch {
      console.error('Maintenance sweep failed; pending work remains durable.');
    }
    maintenanceAt = Date.now() + 15000;
  }
  try {
    if (isLocal()) {
      await local.tick();
    } else {
      const result = await dispatchCloudPoller(machines(), Number(process.env.WORKER_CONCURRENCY || 4));
      if (result.failed) console.error('A cloud step failed; durable retry is scheduled.');
    }
  } catch {
    console.error('Run dispatch is temporarily unavailable.');
  }
  await new Promise((resolve) => setTimeout(resolve, 750));
}
await local.drain();
await pool.end();
await authPool.end();
await credentialPool.end();
