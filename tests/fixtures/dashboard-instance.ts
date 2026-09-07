import { dashboardAccess, readDashboardSnapshot } from '../../packages/core/src/dashboard-freshness';
import { DashboardStreamHub, dashboardStream } from '../../apps/web/lib/dashboard-stream-hub';
import { pool, authPool } from '../../packages/db';
import { config, isLocal } from '../../packages/core/src/config';
import { sseFrames } from '../../sdk/typescript/src/client';

if (!isLocal() || config.allowPaid || config.execution !== 'simulator') throw new Error('Local fixture only');
const controller = new AbortController();
process.on('message', async (message: { cookie: string; organization: string } | 'stop') => {
  if (message === 'stop') {
    controller.abort();
    return;
  }
  try {
    const access = await dashboardAccess(
      new Request(`${config.origin}/account/events?organization_id=${message.organization}`, {
        headers: { cookie: message.cookie },
      }),
    );
    const response = dashboardStream(
      new DashboardStreamHub(readDashboardSnapshot, 30),
      access,
      controller.signal,
    );
    for await (const frame of sseFrames(response)) process.send?.(frame);
  } finally {
    await pool.end();
    await authPool.end();
    process.disconnect();
  }
});
process.send?.({ listening: true });
