import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { start } from 'workflow/api';
import { sleep } from 'workflow';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { fixtureAccount } from '../fixtures/account';
import { admitRun, getRun, cancelRun } from '../../packages/core/src/runs';
import { createWorkspace } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import * as cloud from '../../packages/core/src/cloud-engine';
import { settle, credit, reserve } from '../../packages/core/src/ledger';
import { dispatchRuns } from '../../apps/web/lib/dispatch';
import { agentRun } from '../../apps/web/workflows/run';
import { FaultMachine } from '../fixtures/cloud-machine';
import { renewWorkflow, releaseWorkflow } from '../../packages/core/src/workflow-ownership';
import { maintainRuns } from '../../packages/core/src/engine';
import type { MachineProvider } from '../../packages/core/src/ports';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { id } from '../../packages/core/src/crypto';

// This assertion owns the whole deployment ceiling. Run in the isolated
// scheduling suite, away from unrelated domain tests' intentionally queued work.
vi.mock('workflow/api', () => ({ start: vi.fn(async () => ({})) }));
vi.mock('workflow', () => ({ sleep: vi.fn() }));
// Exercise several real SQL/machine handoffs with short invocations. The unit
// history suite separately runs the production 128-advance ceiling unchanged.
vi.mock('../../apps/web/workflows/policy', () => ({ WORKFLOW_ADVANCES: 12, WORKFLOW_STEP_RETRIES: 3 }));
const runtime = vi.hoisted(() => ({ provider: undefined as MachineProvider | undefined }));
vi.mock('@platform/providers/machines', () => ({ machines: () => runtime.provider || {} }));
const original = { mode: config.mode, execution: config.execution, orchestration: config.orchestration };
const limit = process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
const accounts: string[] = [];
afterEach(async () => {
  Object.assign(config, original);
  vi.restoreAllMocks();
  vi.clearAllMocks();
  runtime.provider = undefined;
  if (limit === undefined) delete process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
  else process.env.GLOBAL_CONCURRENT_RUN_LIMIT = limit;
  for (const org of accounts.splice(0))
    await transaction(org, async (tx) => {
      const runs = (
        await tx.query(
          "SELECT * FROM runs WHERE status IN ('queued','provisioning','running','waiting_for_input','persisting')",
        )
      ).rows;
      for (const run of runs) {
        await settle(tx, org, run.id, BigInt(run.reservation_micro_usd), 0n);
        await tx.query("UPDATE runs SET status='cancelled',completed_at=now() WHERE id=$1", [run.id]);
        await tx.query("UPDATE dispatch_jobs SET state='done' WHERE resource_id=$1", [run.id]);
      }
    });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function fixture() {
  const a = await fixtureAccount('Workflow waiting fixture');
  accounts.push(a.p.organizationId);
  const submit = () =>
    transaction(a.p.organizationId, async (tx) => {
      const project = await resources.create(tx, 'projects', a.p.organizationId, {
        name: 'Workflow fixture',
      });
      const ws = await createWorkspace(tx, a.p, project.id, { name: 'main', branch: 'main' });
      return admitRun(tx, a.p, {
        workspace_id: String((ws.result as { workspace_id: string }).workspace_id),
        prompt: 'Never calls a provider',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      });
    });
  return { a, submit };
}
it('creates Workflows only for jobs that have claimed capacity, preserving the 24-hour SQL wait', async () => {
  const { a, submit } = await fixture();
  const first = await submit(),
    second = await submit();
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '1';
  Object.assign(config, { mode: 'production', execution: 'vercel', orchestration: 'workflow' });
  const result = await dispatchRuns();
  expect(result.dispatched).toBe(1);
  expect(start).toHaveBeenCalledTimes(1);
  expect((await transaction(a.p.organizationId, (tx) => getRun(tx, first.run_id))).status).toBe(
    'provisioning',
  );
  const queued = await transaction(a.p.organizationId, (tx) => getRun(tx, second.run_id));
  expect(queued.status).toBe('queued');
  expect(queued.started_at).toBeNull();
  expect(queued.queue_expires_at.getTime() - queued.created_at.getTime()).toBe(86400000);
  expect(sleep).not.toHaveBeenCalled();
});
it('a legacy waiting Workflow releases its durable outbox lease and exits without a sleep loop', async () => {
  const { a, submit } = await fixture();
  const run = await submit();
  await pool.query("UPDATE dispatch_jobs SET lease_until=now()+interval '5 minutes' WHERE resource_id=$1", [
    run.run_id,
  ]);
  const originalLease = (await job(run.run_id)).lease_until;
  expect(await renewWorkflow(id(), run.run_id, 0)).toBe(false);
  await releaseWorkflow(id(), run.run_id, 0);
  expect((await job(run.run_id)).lease_until).toEqual(originalLease);
  const advance = vi
    .spyOn(cloud, 'advanceCloudRun')
    .mockResolvedValue({ done: false, delaySeconds: 5, queued: true });
  expect(await agentRun(a.p.organizationId, run.run_id)).toEqual({ runId: run.run_id });
  expect(advance).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
  expect(
    (await pool.query('SELECT lease_until FROM dispatch_jobs WHERE resource_id=$1', [run.run_id])).rows[0]
      .lease_until,
  ).toBeNull();
});

it('starts eligible waiting work when a Workflow completes instead of waiting for the next Cron minute', async () => {
  const { a, submit } = await fixture();
  const completed = await submit(),
    waiting = await submit();
  await transaction(a.p.organizationId, async (tx) => {
    await tx.query("UPDATE runs SET status='succeeded',completed_at=now() WHERE id=$1", [completed.run_id]);
    // A short prior job can finish before a failed capacity claim's five-second
    // retry delay. The capacity notification may retry pending work immediately.
    await tx.query("UPDATE dispatch_jobs SET available_at=now()+interval '5 seconds' WHERE resource_id=$1", [
      waiting.run_id,
    ]);
  });
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '1';
  Object.assign(config, { mode: 'production', execution: 'vercel', orchestration: 'workflow' });
  vi.spyOn(cloud, 'advanceCloudRun').mockImplementationOnce(async () => {
    await pool.query("UPDATE dispatch_jobs SET state='done' WHERE resource_id=$1", [completed.run_id]);
    return { done: true, delaySeconds: 0 };
  });
  await agentRun(a.p.organizationId, completed.run_id);
  expect(start).toHaveBeenCalledTimes(1);
  expect((await transaction(a.p.organizationId, (tx) => getRun(tx, waiting.run_id))).status).toBe(
    'provisioning',
  );
});

async function funded(org: string, runId: string) {
  await transaction(org, async (tx) => {
    await credit(tx, org, 4_000_000n, `workflow-fixture:${runId}`);
    await reserve(tx, org, 2_000_000n);
    await tx.query('UPDATE runs SET reservation_micro_usd=2000000 WHERE id=$1', [runId]);
  });
}
async function job(runId: string) {
  return (await pool.query('SELECT * FROM dispatch_jobs WHERE resource_id=$1', [runId])).rows[0];
}
async function held(org: string) {
  return (await pool.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [org])).rows[0]
    .reserved_micro_usd;
}

it('the forward expiry migration changes only defaults for new rows and preserves accepted deadlines, history and funds', async () => {
  const { a, submit } = await fixture();
  const run = await submit(),
    org = a.p.organizationId;
  const terminal = await submit();
  await transaction(org, (tx) => cancelRun(tx, a.p, terminal.run_id));
  await funded(org, run.run_id);
  await transaction(org, (tx) =>
    tx.query("UPDATE runs SET queue_expires_at=created_at+interval '1 hour' WHERE id=$1", [run.run_id]),
  );
  const before = await transaction(org, (tx) => getRun(tx, run.run_id));
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await owner.connect();
  try {
    await owner.query('BEGIN');
    await owner.query("ALTER TABLE runs ALTER COLUMN queue_expires_at SET DEFAULT now()+interval '1 hour'");
    await owner.query(
      await readFile(new URL('../../packages/db/027_queue_deadline_default.sql', import.meta.url), 'utf8'),
    );
    // Reapplying the forward policy must also be harmless.
    await owner.query(
      await readFile(new URL('../../packages/db/027_queue_deadline_default.sql', import.meta.url), 'utf8'),
    );
    const inserted = await owner.query(
      `INSERT INTO runs(id,organization_id,workspace_id,session_id,project_id,status,config)
      SELECT $2,organization_id,workspace_id,session_id,project_id,'queued',config FROM runs WHERE id=$1
      RETURNING extract(epoch FROM queue_expires_at-created_at)::integer AS seconds`,
      [run.run_id, id()],
    );
    expect(inserted.rows[0].seconds).toBe(86400);
    expect(
      (
        await owner.query(
          'SELECT queue_expires_at,config,reservation_micro_usd,status FROM runs WHERE id=$1',
          [run.run_id],
        )
      ).rows[0],
    ).toMatchObject({
      queue_expires_at: before.queue_expires_at,
      config: before.config,
      reservation_micro_usd: '2000000',
      status: 'queued',
    });
    expect(
      (await owner.query('SELECT count(*) FROM run_events WHERE run_id=$1', [run.run_id])).rows[0].count,
    ).toBe('1');
    expect((await owner.query('SELECT status FROM runs WHERE id=$1', [terminal.run_id])).rows[0].status).toBe(
      'cancelled',
    );
    expect(
      (
        await owner.query("SELECT count(*) FROM run_events WHERE run_id=$1 AND type='run.cancelled'", [
          terminal.run_id,
        ])
      ).rows[0].count,
    ).toBe('1');
  } finally {
    await owner.query('ROLLBACK');
    await owner.end();
  }
  expect(await held(org)).toBe('2000000');
});

it.each(['succeeded', 'cancelled'] as const)(
  'hands off execution and persistence, fences recovery, and settles once when %s',
  async (outcome) => {
    const { a, submit } = await fixture();
    const run = await submit(),
      org = a.p.organizationId;
    // A backlog larger than a dispatch batch must not starve the active run's
    // continuation: all slots can stay occupied until that continuation finishes.
    await transaction(org, async (tx) => {
      const project = await resources.create(tx, 'projects', org, { name: 'Waiting backlog' });
      for (let i = 0; i < 12; i++) {
        // These jobs never execute: empty workspace records avoid irrelevant Git
        // repository creation while preserving actual admission and SQL eligibility.
        const ws = await resources.create(tx, 'workspaces', org, {
          project_id: project.id,
          name: `wait-${i}`,
          branch: `wait-${i}`,
          status: 'idle',
          files: [],
          git_files: [],
        });
        await admitRun(tx, a.p, {
          workspace_id: ws.id,
          prompt: 'Waiting only',
          harness: 'codex',
          model: 'fixture-model',
          billing_mode: 'managed',
        });
      }
    });
    process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '1';
    await funded(org, run.run_id);
    const provider = new FaultMachine();
    provider.pendingPolls = 4;
    provider.snapshotPages = 14;
    provider.lostLaunch = true;
    runtime.provider = provider;
    Object.assign(config, { mode: 'production', execution: 'vercel', orchestration: 'workflow' });
    await dispatchRuns();
    const first = await job(run.run_id);
    // Simulate lost start acknowledgement for the continuation. Cron must recover
    // the committed outbox, with no second claim, native prompt, or reservation.
    vi.mocked(start).mockRejectedValueOnce(new Error('lost workflow start acknowledgement'));
    await agentRun(org, run.run_id, first.workflow_generation);
    expect(provider.starts).toBe(1);
    expect(provider.attempts).toBe(2);
    expect(provider.pendingPolls).toBeGreaterThan(0);
    expect(await held(org)).toBe('2000000');
    const interrupted = await job(run.run_id);
    expect(interrupted.error).toBe('workflow_dispatch_failed');
    if (outcome === 'cancelled') await transaction(org, (tx) => cancelRun(tx, a.p, run.run_id));
    await pool.query("UPDATE dispatch_jobs SET lease_until=now()-interval '1 second' WHERE resource_id=$1", [
      run.run_id,
    ]);
    await dispatchRuns();
    const recovered = await job(run.run_id);
    expect(recovered.workflow_generation).toBeGreaterThan(first.workflow_generation);
    expect(await renewWorkflow(org, run.run_id, first.workflow_generation)).toBe(false);
    const lease = recovered.lease_until;
    await releaseWorkflow(org, run.run_id, first.workflow_generation);
    expect((await job(run.run_id)).lease_until).toEqual(lease);
    await agentRun(org, run.run_id, first.workflow_generation);
    await agentRun(org, run.run_id, recovered.workflow_generation);
    // Indexing now crosses its own invocation boundary after native completion.
    expect((await transaction(org, (tx) => getRun(tx, run.run_id))).status).toBe('persisting');
    expect(await held(org)).toBe('2000000');
    const persistence = await job(run.run_id);
    await agentRun(org, run.run_id, persistence.workflow_generation);
    for (let i = 0; i < 3 && (await job(run.run_id)).state !== 'done'; i++) {
      await agentRun(org, run.run_id, (await job(run.run_id)).workflow_generation);
    }
    const final = await transaction(org, (tx) => getRun(tx, run.run_id));
    expect(final).toMatchObject({ status: outcome, lease_generation: '1' });
    expect(final.result.persistence_status).toBe('verified');
    const workspace = await transaction(org, (tx) => resources.get(tx, 'workspaces', final.workspace_id));
    expect(workspace.files).toHaveLength(14);
    expect(
      (
        await transaction(org, (tx) =>
          tx.query("SELECT count(*) FROM run_events WHERE run_id=$1 AND type='output.delta'", [run.run_id]),
        )
      ).rows[0].count,
    ).toBe('1');
    expect(provider.starts).toBe(1);
    expect(await held(org)).toBe('0');
    if (outcome === 'cancelled') expect(provider.cancellations).toBeGreaterThan(0);
    else expect(provider.cancellations).toBe(0);
    expect((await job(run.run_id)).state).toBe('done');
    await agentRun(org, run.run_id, recovered.workflow_generation);
    expect(
      (
        await transaction(org, (tx) =>
          tx.query('SELECT count(*),sum(amount_micro_usd) AS net FROM ledger WHERE reference=$1', [
            `run:${run.run_id}`,
          ]),
        )
      ).rows[0],
    ).toMatchObject({ count: '2', net: '0' });
  },
  // Multiple SQL-backed phase invocations and a >batch backlog use the existing
  // load-suite allowance; ordinary domain and history unit test gates stay intact.
  120_000,
);

it('24-hour SQL waiting survives dispatcher recovery; cancellation and expiry release money with no Workflow start', async () => {
  const { a, submit } = await fixture();
  const active = await submit(),
    queued = await submit(),
    expires = await submit(),
    org = a.p.organizationId;
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '1';
  Object.assign(config, { mode: 'production', execution: 'vercel', orchestration: 'workflow' });
  await dispatchRuns();
  expect(start).toHaveBeenCalledTimes(1);
  await funded(org, queued.run_id);
  await funded(org, expires.run_id);
  // Explicit timestamps advance SQL queue age without changing PostgreSQL time.
  await transaction(org, (tx) =>
    tx.query(
      "UPDATE runs SET created_at=now()-interval '23 hours 59 minutes',queue_expires_at=now()+interval '1 minute' WHERE id=ANY($1::uuid[])",
      [[queued.run_id, expires.run_id]],
    ),
  );
  await pool.query(
    'UPDATE dispatch_jobs SET available_at=now(),lease_until=NULL WHERE resource_id=ANY($1::uuid[])',
    [[queued.run_id, expires.run_id]],
  );
  await dispatchRuns();
  const waiting = await job(queued.run_id);
  expect(waiting.available_at.getTime()).toBeLessThanOrEqual(
    (await transaction(org, (tx) => getRun(tx, queued.run_id))).queue_expires_at.getTime(),
  );
  expect(waiting.available_at.getTime() - Date.now()).toBeGreaterThan(40_000);
  expect(await held(org)).toBe('4000000');
  expect((await transaction(org, (tx) => getRun(tx, queued.run_id))).started_at).toBeNull();
  await transaction(org, (tx) => cancelRun(tx, a.p, queued.run_id));
  await transaction(org, (tx) =>
    tx.query("UPDATE runs SET queue_expires_at=now()-interval '1 millisecond' WHERE id=$1", [expires.run_id]),
  );
  await Promise.all([maintainRuns(), maintainRuns()]);
  expect(await held(org)).toBe('0');
  const expired = await transaction(org, (tx) => getRun(tx, expires.run_id));
  expect(expired).toMatchObject({
    status: 'failed',
    started_at: null,
    config: { prompt: 'Never calls a provider' },
    result: { failure_code: 'queue_expired' },
  });
  expect(start).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
  expect((await job(active.run_id)).state).toBe('running');
  expect(
    (
      await transaction(org, (tx) =>
        tx.query("SELECT type FROM run_events WHERE run_id=$1 AND type='run.failed'", [expires.run_id]),
      )
    ).rows,
  ).toHaveLength(1);
});
