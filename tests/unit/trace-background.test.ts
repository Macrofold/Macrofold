import { afterEach, expect, it, vi } from 'vitest';
import { after } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { scheduleTraceFlush } from '../../apps/web/lib/trace-flush';
import * as tracing from '../../packages/core/src/tracing';
import { agentRun } from '../../apps/web/workflows/run';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('workflow', () => ({ sleep: vi.fn() }));
vi.mock('../../packages/core/src/tracing', () => ({
  tracingEnabled: vi.fn(() => true),
  flushTraces: vi.fn(),
  traceDiagnostic: vi.fn(),
}));
vi.mock('../../packages/core/src/cloud-engine', () => ({ advanceCloudRun: vi.fn() }));
vi.mock('../../packages/core/src/workflow-ownership', () => ({
  renewWorkflow: vi.fn(async () => true),
  releaseWorkflow: vi.fn(),
}));
vi.mock('../../apps/web/lib/dispatch', () => ({ dispatchRuns: vi.fn() }));
vi.mock('@platform/providers/machines', () => ({ machines: () => ({}) }));
afterEach(() => vi.clearAllMocks());

it('finishes subsequent execution phases while the tracing export is still pending', async () => {
  let finish!: () => void;
  const slowExport = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.mocked(tracing.flushTraces).mockReturnValue(slowExport);
  vi.mocked(advanceCloudRun)
    .mockResolvedValueOnce({ done: false, delaySeconds: 0 })
    .mockResolvedValueOnce({ done: true, delaySeconds: 0 });
  try {
    await expect(agentRun('org', 'run', 1)).resolves.toEqual({ runId: 'run' });
    expect(advanceCloudRun).toHaveBeenCalledTimes(2);
    expect(tracing.flushTraces).toHaveBeenCalledTimes(2);
    expect(waitUntil).toHaveBeenCalledWith(slowExport);
  } finally {
    finish();
  }
});
it('does not replace an execution error with a tracing lifecycle error', async () => {
  vi.mocked(waitUntil).mockImplementationOnce(() => {
    throw new Error('no request context');
  });
  vi.mocked(advanceCloudRun).mockRejectedValueOnce(new Error('execution failed'));
  await expect(agentRun('org', 'run', 1)).rejects.toThrow('execution failed');
  expect(tracing.traceDiagnostic).toHaveBeenCalledWith('trace_flush_schedule_failed');
});
it('does not register background work when tracing is disabled', () => {
  vi.mocked(tracing.tracingEnabled).mockReturnValueOnce(false);
  scheduleTraceFlush();
  expect(after).not.toHaveBeenCalled();
});

it('schedules request exports after the full response, including streaming', () => {
  scheduleTraceFlush();
  expect(after).toHaveBeenCalledWith(tracing.flushTraces);
  expect(tracing.flushTraces).not.toHaveBeenCalled();
});
