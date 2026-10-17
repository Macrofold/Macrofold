import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { pool, authPool, credentialPool, transaction } from '../../packages/db';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { FaultMachine } from '../fixtures/cloud-machine';
import { CloudDispatcher } from '../../packages/core/src/portable-dispatch';
import { advanceCloudRun } from '../../packages/core/src/cloud-engine';
import * as cloudEngine from '../../packages/core/src/cloud-engine';
import { admitRun, getRun, cancelRun } from '../../packages/core/src/runs';
import { admitInference } from '../../packages/core/src/inferences';
import { createWorktree } from '../../packages/core/src/files';
import { createKey } from '../../packages/core/src/keys';
import { credit } from '../../packages/core/src/ledger';
import { config } from '../../packages/core/src/config';
import { claimRun } from '../../packages/core/src/engine';
import { queueObservations } from '../../packages/core/src/scheduling';
import * as resources from '../../packages/core/src/resources';
import { decisionExample } from '../../examples/decisions/contracts';
import { dispatchLimits } from '../../packages/core/src/capacity';
const accounts: string[] = [];
const originalPaid = config.allowPaid;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
afterEach(async () => {
  for (const org of accounts.splice(0)) await retireFixtureRuns(org);
  config.allowPaid = originalPaid;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});
async function fixture() {
  const { p } = await fixtureAccount('Independent poller');
  accounts.push(p.organizationId);
  const workspace = await transaction(p.organizationId, async (tx) => {
    await credit(tx, p.organizationId, 100_000_000n, 'poller-fixture');
    await tx.query("UPDATE organizations SET plan='scale' WHERE id=$1", [p.organizationId]);
    return resources.create(tx, 'workspaces', p.organizationId, { name: 'Poller fixture' });
  });
  const native = async () =>
    transaction(p.organizationId, async (tx) => {
      const worktree = await createWorktree(tx, p, workspace.id, {});
      return admitRun(tx, p, {
        worktree_id: worktree.result.worktree_id,
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
        prompt: 'Synthetic queue fixture',
      });
    });
  return { p, workspace, native, get: (id: string) => transaction(p.organizationId, (tx) => getRun(tx, id)) };
}

it('enforces separate fleet ceilings without blocking the other execution class', async () => {
  const f = await fixture();
  const counts = (
    await pool.query(`SELECT count(*) FILTER(WHERE kind='native_agent')::int AS native,
    count(*) FILTER(WHERE kind<>'native_agent')::int AS inference FROM reporting.scheduling_runs
    WHERE status IN ('provisioning','running','waiting_for_input','persisting')`)
  ).rows[0];
  vi.stubEnv('NATIVE_CONCURRENT_RUN_LIMIT', String(counts.native + 1));
  vi.stubEnv('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', String(counts.inference + 1));
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '10000');
  vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-only');
  config.allowPaid = true;
  const first = await f.native(),
    second = await f.native();
  const lights = await transaction(f.p.organizationId, async (tx) => {
    const key = await createKey(tx, f.p, {
      name: 'Application',
      workspace_id: f.workspace.id,
      scopes: ['runs:read', 'runs:write'],
    });
    const app = {
      ...f.p,
      id: key.id,
      kind: 'api_key' as const,
      workspaceIds: [f.workspace.id],
      scopes: key.scopes,
    };
    return [
      await admitInference(tx, app, decisionExample(f.workspace.id, 'triage')),
      await admitInference(tx, app, decisionExample(f.workspace.id, 'triage')),
    ];
  });
  expect(await claimRun(f.p.organizationId, first.run_id)).toBeTruthy();
  expect(await claimRun(f.p.organizationId, second.run_id)).toBeNull();
  expect(await claimRun(f.p.organizationId, lights[0].run_id)).toBeTruthy();
  expect(await claimRun(f.p.organizationId, lights[1].run_id)).toBeNull();
  const reasons = await transaction(f.p.organizationId, (tx) =>
    queueObservations(tx, [second.run_id, lights[1].run_id]),
  );
  expect(reasons.get(second.run_id)).toBe('global_capacity');
  expect(reasons.get(lights[1].run_id)).toBe('lightweight_capacity');
});

it('accepts more than ten queued session runs while honoring a configured queue boundary', async () => {
  const f = await fixture(),
    first = await f.native();
  const append = () =>
    transaction(f.p.organizationId, (tx) =>
      admitRun(tx, f.p, {
        session_id: first.session_id,
        queue_if_busy: true,
        prompt: 'Queued fixture',
      }),
    );
  vi.stubEnv('SESSION_QUEUED_RUN_LIMIT', '12');
  for (let i = 1; i < 12; i++) await append();
  await expect(append()).rejects.toMatchObject({ code: 'queue_full' });
});

it('completes newly queued inference while a native checkpoint upload is still pending', async () => {
  const f = await fixture(),
    native = await f.native(),
    provider = new FaultMachine();
  for (let n = 0; n < 30; n++) {
    if ((await f.get(native.run_id)).execution_binding?.phase === 'upload') break;
    await advanceCloudRun(f.p.organizationId, native.run_id, provider);
  }
  expect((await f.get(native.run_id)).execution_binding?.phase).toBe('upload');
  const entered = barrier(),
    upload = barrier();
  const chunk = provider.chunk.bind(provider);
  const read = vi.spyOn(provider, 'chunk').mockImplementation(async () => {
    entered.release();
    await upload.promise;
    return chunk();
  });
  const dispatcher = new CloudDispatcher(
    provider,
    { inference: 1, provision: 2, transfer: 1, control: 1 },
    f.p.organizationId,
  );
  let drained = false;
  try {
    await pool.query('UPDATE dispatch_jobs SET available_at=now() WHERE resource_id=$1', [native.run_id]);
    await dispatcher.tick();
    await entered.promise;
    // Expiring the SQL claim must not let this same process re-enter its live step.
    await pool.query('UPDATE dispatch_jobs SET available_at=now() WHERE resource_id=$1', [native.run_id]);
    config.allowPaid = true;
    vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-only');
    const call = vi.fn(async () =>
      Response.json({
        type: 'message',
        model: 'claude-haiku-4-5-20251001',
        content: [{ type: 'text', text: '"wait"' }],
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );
    vi.stubGlobal('fetch', call);
    const inference = await transaction(f.p.organizationId, async (tx) => {
      const key = await createKey(tx, f.p, {
        name: 'Application',
        workspace_id: f.workspace.id,
        scopes: ['runs:read', 'runs:write'],
      });
      return admitInference(
        tx,
        { ...f.p, id: key.id, kind: 'api_key', workspaceIds: [f.workspace.id], scopes: key.scopes },
        decisionExample(f.workspace.id, 'triage'),
      );
    });
    for (let n = 0; n < 10 && (await f.get(inference.run_id)).status !== 'succeeded'; n++) {
      await dispatcher.tick();
      await dispatcher.waitForProgress();
    }
    expect(await f.get(inference.run_id)).toMatchObject({
      status: 'succeeded',
      started_at: expect.any(Date),
    });
    expect(call).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    expect((await f.get(native.run_id)).status).toBe('persisting');
    const draining = dispatcher.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    upload.release();
    await draining;
  } finally {
    upload.release();
    await dispatcher.drain();
  }
  expect(drained).toBe(true);
  // Finish through the same dispatcher and verify persistence and single launch.
  for (let n = 0; n < 20 && (await f.get(native.run_id)).status !== 'succeeded'; n++) {
    await dispatcher.tick();
    await dispatcher.waitForProgress();
  }
  await dispatcher.drain();
  expect((await f.get(native.run_id)).result.persistence_status).toBe('verified');
  expect(provider.starts).toBe(1);
});

it('bounds executing steps and refills a free slot independently of another slow step', async () => {
  const f = await fixture(),
    provider = new FaultMachine();
  const first = await f.native(),
    second = await f.native(),
    third = await f.native();
  const firstGate = barrier(),
    secondGate = barrier();
  const provision = provider.provision.bind(provider);
  let active = 0,
    maximum = 0;
  vi.spyOn(provider, 'provision').mockImplementation(async (name) => {
    active++;
    maximum = Math.max(maximum, active);
    await (name.includes(first.run_id) ? firstGate.promise : secondGate.promise);
    active--;
    return provision(name);
  });
  const dispatcher = new CloudDispatcher(provider, 2, f.p.organizationId);
  try {
    // Wait for both barriers, including any short fair-admission lease deferral.
    await vi.waitFor(
      async () => {
        await dispatcher.tick();
        expect(active).toBe(2);
      },
      { timeout: 8000, interval: 20 },
    );
    await dispatcher.tick();
    expect((await f.get(third.run_id)).status).toBe('queued');
    secondGate.release();
    await dispatcher.waitForProgress();
    await vi.waitFor(
      async () => {
        await dispatcher.tick();
        expect((await f.get(third.run_id)).started_at).toBeInstanceOf(Date);
      },
      { timeout: 8000, interval: 20 },
    );
    expect((await f.get(third.run_id)).started_at).toBeInstanceOf(Date);
    expect((await f.get(first.run_id)).execution_binding?.phase).toBe('provision');
    expect(maximum).toBe(2);
    expect((await f.get(second.run_id)).started_at).toBeInstanceOf(Date);
  } finally {
    firstGate.release();
    secondGate.release();
    await dispatcher.drain();
  }
});

it('records a failed step once, contains its rejection, and honors retry backoff', async () => {
  const f = await fixture(),
    run = await f.native();
  const advance = vi.spyOn(cloudEngine, 'advanceCloudRun').mockRejectedValueOnce(Error('private failure'));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const dispatcher = new CloudDispatcher(new FaultMachine(), 1, f.p.organizationId);
  await dispatcher.tick();
  await dispatcher.drain();
  const job = (
    await pool.query(
      'SELECT failure_attempts,error,available_at>now() AS delayed FROM dispatch_jobs WHERE resource_id=$1',
      [run.run_id],
    )
  ).rows[0];
  expect(job).toMatchObject({ failure_attempts: 1, error: 'poller_advance_failed', delayed: true });
  await dispatcher.tick();
  await dispatcher.drain();
  expect(advance).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls.flat().join(' ')).not.toContain('private failure');
});

it('rereads cancellation during retained native work and yields before changing resource pools', async () => {
  const f = await fixture(),
    run = await f.native(),
    provider = new FaultMachine();
  for (let steps = 0; steps < 20 && (await f.get(run.run_id)).execution_binding?.phase !== 'poll'; steps++)
    await advanceCloudRun(f.p.organizationId, run.run_id, provider);
  expect((await f.get(run.run_id)).execution_binding?.phase).toBe('poll');
  const probe = provider.probe.bind(provider);
  vi.spyOn(provider, 'probe').mockImplementationOnce(async (binding, offset) => {
    await transaction(f.p.organizationId, (tx) => cancelRun(tx, f.p, run.run_id));
    return probe(binding, offset);
  });
  const dispatcher = new CloudDispatcher(provider, 1, f.p.organizationId);
  await pool.query('UPDATE dispatch_jobs SET available_at=now() WHERE resource_id=$1', [run.run_id]);
  await dispatcher.tick();
  await dispatcher.drain();
  expect(provider.cancellations).toBe(1);
  expect((await f.get(run.run_id)).execution_binding?.phase).toBe('index');
  expect(
    (await pool.query('SELECT dispatch_class FROM reporting.scheduling_runs WHERE id=$1', [run.run_id]))
      .rows[0]?.dispatch_class,
  ).toBe('transfer');
  expect(provider.closes).toHaveLength(0);
});

it('can fill more than twenty phase slots without exceeding the configured pool', async () => {
  const f = await fixture();
  for (let i = 0; i < 26; i++) await f.native();
  const gate = barrier();
  const advance = vi.spyOn(cloudEngine, 'advanceCloudRun').mockImplementation(async () => {
    await gate.promise;
    return { done: false, delaySeconds: 1 };
  });
  const dispatcher = new CloudDispatcher(
    new FaultMachine(),
    {
      inference: 1,
      provision: 24,
      transfer: 1,
      control: 1,
    },
    f.p.organizationId,
  );
  try {
    await dispatcher.tick();
    expect(advance).toHaveBeenCalledTimes(24);
    await dispatcher.tick();
    expect(advance).toHaveBeenCalledTimes(24);
  } finally {
    gate.release();
    await dispatcher.drain();
  }
});

it.each([
  ['provision', null],
  ['transfer', 'upload'],
  ['control', 'probe'],
] as const)('fills the default %s pool and leaves excess work queued', async (resource, phase) => {
  const f = await fixture(),
    limit = dispatchLimits()[resource];
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '1000');
  vi.stubEnv('NATIVE_CONCURRENT_RUN_LIMIT', '1000');
  const ids: string[] = [];
  for (let i = 0; i <= limit; i++) ids.push((await f.native()).run_id);
  if (phase)
    await transaction(f.p.organizationId, async (tx) => {
      await tx.query("UPDATE runs SET status='running',execution_binding=$2 WHERE id=ANY($1::uuid[])", [
        ids,
        JSON.stringify({ phase, provider: 'vercel' }),
      ]);
      await tx.query(
        "UPDATE dispatch_jobs SET state='running',available_at=now() WHERE resource_id=ANY($1::uuid[])",
        [ids],
      );
    });
  const gate = barrier();
  const advance = vi.spyOn(cloudEngine, 'advanceCloudRun').mockImplementation(async () => {
    await gate.promise;
    return { done: false, delaySeconds: 1 };
  });
  const dispatcher = new CloudDispatcher(new FaultMachine(), dispatchLimits(), f.p.organizationId);
  try {
    await dispatcher.tick();
    expect(advance).toHaveBeenCalledTimes(limit);
    await dispatcher.tick();
    expect(advance).toHaveBeenCalledTimes(limit);
  } finally {
    gate.release();
    await dispatcher.drain();
  }
});
