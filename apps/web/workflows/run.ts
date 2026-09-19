import { sleep } from 'workflow';
import { WORKFLOW_ADVANCES, WORKFLOW_STEP_RETRIES } from './policy';

async function advance(organization: string, runId: string, generation: number) {
  'use step';
  const { renewWorkflow } = await import('@platform/core/workflow-ownership');
  if (!(await renewWorkflow(organization, runId, generation))) return { superseded: true } as const;
  const { advanceCloudRun } = await import('@platform/core/cloud-engine');
  const { machines } = await import('@platform/providers/machines');
  const { flushTracesInBackground } = await import('../lib/trace-background');
  try {
    return await advanceCloudRun(organization, runId, machines);
  } finally {
    flushTracesInBackground();
  }
}
advance.maxRetries = WORKFLOW_STEP_RETRIES;

async function dispatchWaitingRuns(organization: string, runId: string, generation: number) {
  'use step';
  const { releaseWorkflow } = await import('@platform/core/workflow-ownership');
  await releaseWorkflow(organization, runId, generation);
  // Refill capacity or continue the SAME persisted execution. Cron repairs a lost
  // notification; native admission and its financial reservation never repeat.
  const { dispatchRuns } = await import('../lib/dispatch');
  await dispatchRuns(true);
}
dispatchWaitingRuns.maxRetries = WORKFLOW_STEP_RETRIES;

export async function agentRun(organization: string, runId: string, generation = 0) {
  'use workflow';
  for (let advances = 0; advances < WORKFLOW_ADVANCES; advances++) {
    const result = await advance(organization, runId, generation);
    if ('superseded' in result) return { runId };
    if (result.done || result.queued) {
      await dispatchWaitingRuns(organization, runId, generation);
      return { runId };
    }
    if (result.delaySeconds > 0) await sleep(`${result.delaySeconds}s`);
  }
  await dispatchWaitingRuns(organization, runId, generation);
  return { runId };
}
