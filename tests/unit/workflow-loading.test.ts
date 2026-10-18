import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  local: true,
  config: { execution: 'vercel', orchestration: 'workflow' },
  apiLoaded: vi.fn(),
  workflowLoaded: vi.fn(),
  importsReady: undefined as Promise<void> | undefined,
  start: vi.fn(async () => ({})),
  agentRun: vi.fn(),
  pending: vi.fn(async () => [{ resource_id: 'run' }]),
  query: vi.fn(async () => ({
    rows: [{ organization_id: 'org', resource_id: 'run', state: 'pending', workflow_generation: 7 }],
  })),
  claim: vi.fn(async () => true),
  renew: vi.fn(async () => true),
  failed: vi.fn(),
  flush: vi.fn(),
}));

vi.mock('workflow/api', async () => {
  fixture.apiLoaded();
  await fixture.importsReady;
  return { start: fixture.start };
});
vi.mock('../../apps/web/workflows/run', () => {
  fixture.workflowLoaded();
  return { agentRun: fixture.agentRun };
});
vi.mock('../../packages/db', () => ({ pool: { query: fixture.query } }));
vi.mock('../../packages/core/src/config', () => ({
  config: fixture.config,
  isLocal: () => fixture.local,
}));
vi.mock('../../packages/core/src/scheduling', () => ({
  pendingRunCandidates: fixture.pending,
  orderDispatchJobs: (jobs: unknown[]) => jobs,
}));
vi.mock('../../packages/core/src/engine', () => ({ claimRun: fixture.claim }));
vi.mock('../../packages/core/src/workflow-ownership', () => ({ renewWorkflow: fixture.renew }));
vi.mock('../../packages/core/src/dispatch-failures', () => ({ dispatchFailed: fixture.failed }));
vi.mock('../../apps/web/lib/trace-background', () => ({ flushTracesInBackground: fixture.flush }));

import { dispatchRuns } from '../../apps/web/lib/dispatch';

afterEach(() => vi.unstubAllEnvs());

it('loads Workflow only for its deployment profile and before leasing jobs', async () => {
  vi.stubEnv('WORKFLOW_DISPATCH_BATCH', '100');
  vi.stubEnv('WORKFLOW_START_CONCURRENCY', '16');
  for (const profile of [
    { local: true, execution: 'vercel', orchestration: 'workflow' },
    { local: false, execution: 'docker', orchestration: 'workflow' },
    { local: false, execution: 'vercel', orchestration: 'poller' },
  ]) {
    fixture.local = profile.local;
    Object.assign(fixture.config, profile);
    await expect(dispatchRuns()).resolves.toEqual({ dispatched: 0 });
  }
  expect(fixture.apiLoaded).not.toHaveBeenCalled();
  expect(fixture.workflowLoaded).not.toHaveBeenCalled();
  expect(fixture.pending).not.toHaveBeenCalled();
  expect(fixture.query).not.toHaveBeenCalled();

  fixture.local = false;
  Object.assign(fixture.config, { execution: 'vercel', orchestration: 'workflow' });
  let release!: () => void;
  fixture.importsReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  const dispatched = dispatchRuns();
  try {
    await vi.waitFor(() => expect(fixture.apiLoaded).toHaveBeenCalledOnce());
    expect(fixture.pending).not.toHaveBeenCalled();
    expect(fixture.query).not.toHaveBeenCalled();
  } finally {
    release();
  }
  await expect(dispatched).resolves.toEqual({ dispatched: 1 });
  expect(fixture.workflowLoaded).toHaveBeenCalledOnce();
  expect(fixture.renew).toHaveBeenCalledExactlyOnceWith('org', 'run', 7);
  expect(fixture.start).toHaveBeenCalledExactlyOnceWith(fixture.agentRun, ['org', 'run', 7]);
  expect(fixture.failed).not.toHaveBeenCalled();
  expect(fixture.flush).toHaveBeenCalledTimes(4);
});
