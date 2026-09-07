import { afterEach, expect, it, vi } from 'vitest';
import { sleep } from 'workflow';
import { agentRun } from '../../apps/web/workflows/run';
import { WORKFLOW_ADVANCES, WORKFLOW_STEP_RETRIES } from '../../apps/web/workflows/policy';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import { renewWorkflow, releaseWorkflow } from '../../packages/core/src/workflow-ownership';
import { dispatchRuns } from '../../apps/web/lib/dispatch';
import { queueRetryAt } from '../../packages/core/src/queue-wait';

vi.mock('workflow', () => ({ sleep: vi.fn() }));
vi.mock('../../packages/core/src/cloud-engine', () => ({ advanceCloudRun: vi.fn() }));
vi.mock('../../packages/core/src/workflow-ownership', () => ({
  renewWorkflow: vi.fn(async () => true),
  releaseWorkflow: vi.fn(),
}));
vi.mock('../../apps/web/lib/dispatch', () => ({ dispatchRuns: vi.fn() }));
vi.mock('@platform/providers/machines', () => ({ machines: () => ({}) }));
afterEach(() => vi.clearAllMocks());

const submitted = Date.UTC(2026, 0, 1);
const waiting = {
  id: 'queue-fixture',
  created_at: new Date(submitted),
  queue_expires_at: new Date(submitted + 86400_000),
};
it.each([
  [0, 5],
  [5, 10],
  [15, 20],
  [35, 40],
  [75, 60],
  [86300, 60],
])('backs off durably at age %ss with a %ss ceiling and bounded jitter', (age, ceiling) => {
  const now = submitted + age * 1000;
  const retry = queueRetryAt(waiting, now).getTime() - now;
  expect(retry).toBeGreaterThanOrEqual(ceiling * 800);
  expect(retry).toBeLessThanOrEqual(ceiling * 1000);
  expect(queueRetryAt(structuredClone(waiting), now).getTime()).toBe(now + retry);
});
it('covers a full 24-hour wait, stops exactly at expiry, and retains jitter across restart', () => {
  let now = submitted,
    checks = 0;
  while (now < waiting.queue_expires_at.getTime()) {
    const next = queueRetryAt(waiting, now).getTime();
    expect(next).toBeGreaterThan(now);
    expect(next - now).toBeLessThanOrEqual(60_000);
    now = next;
    checks++;
  }
  expect(now).toBe(submitted + 86400_000);
  expect(checks).toBeGreaterThan(1440);
  expect(checks).toBeLessThan(1810);
  expect(queueRetryAt(waiting, now + 10_000).getTime()).toBe(now);
  expect(queueRetryAt({ ...waiting, queue_expires_at: new Date(submitted + 250) }, submitted).getTime()).toBe(
    submitted + 250,
  );
  expect(queueRetryAt({ ...waiting, id: 'another-run' }, submitted)).not.toEqual(
    queueRetryAt(waiting, submitted),
  );
  expect(queueRetryAt(waiting, submitted - 1000).getTime() - submitted).toBeLessThanOrEqual(4000);
});

it.each([1, 2, 5, 60])(
  'bounds every advance and sleep together, including %ss failure/lease delays',
  async (delaySeconds) => {
    vi.mocked(advanceCloudRun).mockResolvedValue({ done: false, delaySeconds });
    await agentRun('org', 'run', 7);
    expect(advanceCloudRun).toHaveBeenCalledTimes(128);
    expect(sleep).toHaveBeenCalledTimes(128);
    expect(releaseWorkflow).toHaveBeenCalledExactlyOnceWith('org', 'run', 7);
    expect(dispatchRuns).toHaveBeenCalledExactlyOnceWith(true);
  },
);
it.each([
  { done: true, delaySeconds: 0 },
  { done: false, queued: true, delaySeconds: 60 },
])('exits terminal or legacy queued work without adding sleep history', async (result) => {
  vi.mocked(advanceCloudRun).mockResolvedValue(result);
  await agentRun('org', 'run', 3);
  expect(advanceCloudRun).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
  expect(releaseWorkflow).toHaveBeenCalledExactlyOnceWith('org', 'run', 3);
});
it('a superseded invocation exits without touching the native execution or releasing its successor', async () => {
  vi.mocked(renewWorkflow).mockResolvedValueOnce(false);
  await agentRun('org', 'run', 2);
  expect(advanceCloudRun).not.toHaveBeenCalled();
  expect(releaseWorkflow).not.toHaveBeenCalled();
  expect(sleep).not.toHaveBeenCalled();
});

it('budgets maximum execution, trace draining and persistence plus retries across bounded invocations', () => {
  // Conservative workload envelope, not a claim of a live 10-GiB transfer:
  // 100k entries with distinct partial chunks plus 10 GiB / 4 MiB full chunks.
  const entries = 100_000,
    chunks = 102_560;
  const input = Math.ceil(entries / 16);
  const workload =
    input +
    Math.ceil((chunks + input) / 4) +
    1 +
    4 +
    Math.ceil(7200 / 3) + // provision/restore/launch and conservative restore wait
    Math.ceil(7200 / 2) +
    1025 + // max execution plus 64-MiB trace draining
    Math.ceil(entries / 32) +
    Math.ceil(chunks / 4) +
    Math.ceil(entries / 8) +
    3;
  expect(workload).toBeGreaterThan(70_000); // proves one monolithic Workflow cannot fit
  // Include two domain transport failures before EVERY successful phase. These
  // are advance iterations, distinct from the SDK's three retries of each step.
  let remaining = workload * 3,
    invocations = 0;
  while (remaining > 0) {
    const advances = Math.min(WORKFLOW_ADVANCES, remaining);
    const steps = advances + 1; // handoff/dispatch is also a step
    const sleeps = advances;
    const events = steps * (3 + 2 * WORKFLOW_STEP_RETRIES) + sleeps * 2 + 32;
    expect(events).toBeLessThanOrEqual(1449);
    expect(events).toBeLessThan(2000);
    expect(steps + sleeps).toBeLessThan(10_000); // count waits as steps conservatively
    remaining -= advances;
    invocations++;
  }
  expect(invocations).toBeGreaterThan(1000);
});
