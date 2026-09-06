import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { start } from 'workflow/api';
import { sleep } from 'workflow';
import { pool, authPool, transaction } from '../../packages/db';
import { config } from '../../packages/core/src/config';
import { fixtureAccount } from '../fixtures/account';
import { admitRun, getRun } from '../../packages/core/src/runs';
import { createWorkspace } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import * as cloud from '../../packages/core/src/cloud-engine';
import { settle } from '../../packages/core/src/ledger';
import { dispatchRuns } from '../../apps/web/lib/dispatch';
import { agentRun } from '../../apps/web/workflows/run';

// This assertion owns the whole deployment ceiling. Run in the isolated
// scheduling suite, away from unrelated domain tests' intentionally queued work.
vi.mock('workflow/api', () => ({ start: vi.fn(async () => ({})) }));
vi.mock('workflow', () => ({ sleep: vi.fn() }));
vi.mock('@platform/providers/machines', () => ({ machines: () => ({}) }));
const original = { mode: config.mode, execution: config.execution, orchestration: config.orchestration };
const limit = process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
const accounts: string[] = [];
afterEach(async () => {
  Object.assign(config, original);
  vi.restoreAllMocks();
  vi.clearAllMocks();
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
    await tx.query("UPDATE dispatch_jobs SET state='done' WHERE resource_id=$1", [completed.run_id]);
    // A short prior job can finish before a failed capacity claim's five-second
    // retry delay. The capacity notification may retry pending work immediately.
    await tx.query("UPDATE dispatch_jobs SET available_at=now()+interval '5 seconds' WHERE resource_id=$1", [
      waiting.run_id,
    ]);
  });
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = '1';
  Object.assign(config, { mode: 'production', execution: 'vercel', orchestration: 'workflow' });
  vi.spyOn(cloud, 'advanceCloudRun').mockResolvedValue({ done: true, delaySeconds: 0 });
  await agentRun(a.p.organizationId, completed.run_id);
  expect(start).toHaveBeenCalledTimes(1);
  expect((await transaction(a.p.organizationId, (tx) => getRun(tx, waiting.run_id))).status).toBe(
    'provisioning',
  );
});
