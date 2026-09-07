import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { createWorld } from 'workflow/runtime';

afterEach(() => vi.unstubAllEnvs());
it('the pinned local Workflow world records lifecycle, retry and sleep history without replay duplicates', async () => {
  const require = createRequire(import.meta.url);
  const pkg = JSON.parse(
    await readFile(path.resolve(require.resolve('workflow/api'), '../../package.json'), 'utf8'),
  );
  expect(pkg.version).toBe('4.8.5'); // SDK upgrades require rechecking the history budget.
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-history-'));
  vi.stubEnv('WORKFLOW_TARGET_WORLD', 'local');
  vi.stubEnv('WORKFLOW_LOCAL_DATA_DIR', directory);
  vi.stubEnv('WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS', 'false');
  const world = createWorld();
  try {
    await world.start?.();
    const created = await world.events.create(null, {
      eventType: 'run_created',
      eventData: { deploymentId: 'fixture', workflowName: 'history', input: new Uint8Array() },
    });
    const runId = created.run!.runId;
    await world.events.create(runId, { eventType: 'run_started' });
    await world.events.create(runId, { eventType: 'run_started' });
    const correlationId = 'step_fixture';
    await world.events.create(runId, {
      eventType: 'step_created',
      correlationId,
      eventData: { stepName: 'advance', input: new Uint8Array() },
    });
    for (let attempt = 0; attempt < 4; attempt++) {
      await world.events.create(runId, { eventType: 'step_started', correlationId });
      if (attempt < 3)
        await world.events.create(runId, {
          eventType: 'step_retrying',
          correlationId,
          eventData: { error: 'transport fixture' },
        });
    }
    await world.events.create(runId, {
      eventType: 'step_completed',
      correlationId,
      eventData: { result: new Uint8Array() },
    });
    const resumeAt = new Date(0);
    await world.events.create(runId, {
      eventType: 'wait_created',
      correlationId: 'wait_fixture',
      eventData: { resumeAt },
    });
    await world.events.create(runId, {
      eventType: 'wait_completed',
      correlationId: 'wait_fixture',
      eventData: { resumeAt },
    });
    await world.events.create(runId, { eventType: 'run_completed', eventData: { output: new Uint8Array() } });
    const { data } = await world.events.list({ runId });
    expect(data.map((e) => e.eventType)).toEqual([
      'run_created',
      'run_started',
      'step_created',
      'step_started',
      'step_retrying',
      'step_started',
      'step_retrying',
      'step_started',
      'step_retrying',
      'step_started',
      'step_completed',
      'wait_created',
      'wait_completed',
      'run_completed',
    ]);
    expect(data.filter((e) => e.eventType.startsWith('step_'))).toHaveLength(9);
    expect(data.filter((e) => e.eventType.startsWith('wait_'))).toHaveLength(2);
  } finally {
    await world.close?.();
    await rm(directory, { recursive: true, force: true });
  }
});
