import { sleep } from 'workflow';

async function advance(organization: string, runId: string) {
  'use step';
  const { advanceCloudRun } = await import('@platform/core/cloud-engine');
  const { machines } = await import('@platform/providers/machines');
  const result = await advanceCloudRun(organization, runId, machines());
  if (result.queued) {
    // Release a legacy/pre-upgrade waiting Workflow back to the durable outbox.
    const { pool } = await import('@platform/db');
    await pool.query(
      "UPDATE dispatch_jobs SET lease_until=NULL,available_at=now()+interval '5 seconds' WHERE kind='run' AND resource_id=$1 AND state='pending'",
      [runId],
    );
  }
  return result;
}
async function dispatchWaitingRuns() {
  'use step';
  // Completion releases capacity. Refill it promptly; Cron remains the durable
  // fallback if this notification fails. Start claims retain the same SQL fence.
  const { dispatchRuns } = await import('../lib/dispatch');
  await dispatchRuns(true);
}
export async function agentRun(organization: string, runId: string) {
  'use workflow';
  while (true) {
    const result = await advance(organization, runId);
    if (result.done) {
      await dispatchWaitingRuns();
      return { runId };
    }
    if (result.queued) return { runId };
    await sleep(`${result.delaySeconds}s`);
  }
}
