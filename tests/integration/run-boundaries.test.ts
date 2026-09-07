import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { authPool, pool, transaction } from '../../packages/db';
import { admitRun, cancelRun, getRun, submitInput } from '../../packages/core/src/runs';
import { claimRun } from '../../packages/core/src/engine';
import { createWorkspace } from '../../packages/core/src/files';
import * as resources from '../../packages/core/src/resources';
import { fixtureAccount } from '../fixtures/account';
import { id } from '../../packages/core/src/crypto';
import { config } from '../../packages/core/src/config';
import * as catalog from '../../packages/core/src/catalog';
import { credit } from '../../packages/core/src/ledger';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
const executionProvider = config.execution;
beforeAll(async () => {
  account = await fixtureAccount('Run state boundaries');
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  config.execution = executionProvider;
  // These tests deliberately arrange intermediate states without starting a worker.
  // Retire them so later capacity tests never see a synthetic active execution.
  await transaction(account.p.organizationId, async (tx) => {
    await tx.query(
      "UPDATE runs SET status='cancelled',completed_at=now() WHERE organization_id=$1 AND status NOT IN ('succeeded','failed','cancelled','timed_out')",
      [account.p.organizationId],
    );
    await tx.query("UPDATE dispatch_jobs SET state='done' WHERE organization_id=$1 AND kind='run'", [
      account.p.organizationId,
    ]);
  });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
async function queued(limits?: { timeout_seconds: number; max_cost_micro_usd: string }) {
  return transaction(account.p.organizationId, async (tx) => {
    const project = await resources.create(tx, 'projects', account.p.organizationId, {
      name: 'State fixture',
    });
    const created = await createWorkspace(tx, account.p, project.id, { name: 'main', branch: 'main' });
    const workspace = (created.result as { workspace_id: string }).workspace_id;
    return admitRun(tx, account.p, {
      workspace_id: workspace,
      harness: 'codex',
      model: 'fixture-model',
      billing_mode: 'managed',
      prompt: 'Local state fixture',
      limits,
    });
  });
}
const row = (run: string) => transaction(account.p.organizationId, (tx) => getRun(tx, run));
const query = (sql: string, values: unknown[]) =>
  transaction(account.p.organizationId, (tx) => tx.query(sql, values));

describe('run state transitions and concurrent requests', () => {
  it('rejects an unfunded compute window before admission and releases an exact-boundary reservation on cancel', async () => {
    const models = catalog.models();
    vi.spyOn(catalog, 'models').mockReturnValue(models);
    config.execution = 'vercel';
    vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', '8000');
    await transaction(account.p.organizationId, (tx) =>
      credit(tx, account.p.organizationId, 100000n, `compute:${id()}`),
    );
    const before = await query('SELECT id FROM runs', []);
    await expect(queued({ timeout_seconds: 60, max_cost_micro_usd: '7999' })).rejects.toMatchObject({
      status: 400,
      code: 'run_budget_too_small',
    });
    expect((await query('SELECT id FROM runs', [])).rows).toEqual(before.rows);
    expect(
      (await query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [account.p.organizationId]))
        .rows[0].reserved_micro_usd,
    ).toBe('0');

    const accepted = await queued({ timeout_seconds: 60, max_cost_micro_usd: '8000' });
    expect((await row(accepted.run_id)).reservation_micro_usd).toBe('8000');
    await transaction(account.p.organizationId, (tx) => cancelRun(tx, account.p, accepted.run_id));
    expect(
      (await query('SELECT reserved_micro_usd FROM organizations WHERE id=$1', [account.p.organizationId]))
        .rows[0].reserved_micro_usd,
    ).toBe('0');
  });
  it('cancels a queued run exactly once under competing requests', async () => {
    const run = await queued();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        transaction(account.p.organizationId, (tx) => cancelRun(tx, account.p, run.run_id)),
      ),
    );
    expect(results.every((result) => result.status === 'cancelled')).toBe(true);
    expect((await row(run.run_id)).result.persistence_status).toBe('not_required');
    const events = await query("SELECT 1 FROM run_events WHERE run_id=$1 AND type='run.cancelled'", [
      run.run_id,
    ]);
    expect(events.rowCount).toBe(1);
    expect(await claimRun(account.p.organizationId, run.run_id)).toBeNull();
  });
  it.each(['succeeded', 'failed', 'cancelled', 'timed_out'] as const)(
    'cancellation preserves an already %s run and its result',
    async (status) => {
      const run = await queued();
      await query('UPDATE runs SET status=$2,completed_at=now(),result=$3 WHERE id=$1', [
        run.run_id,
        status,
        { output_text: 'retained', persistence_status: 'verified' },
      ]);
      const before = await row(run.run_id);
      await transaction(account.p.organizationId, (tx) => cancelRun(tx, account.p, run.run_id));
      const after = await row(run.run_id);
      expect(after.status).toBe(status);
      expect(after.result).toEqual(before.result);
      expect(after.completed_at).toEqual(before.completed_at);
    },
  );
  it('rejects an expired queue entry before acquiring an execution lease', async () => {
    const run = await queued();
    await query("UPDATE runs SET queue_expires_at=now()-interval '1 second' WHERE id=$1", [run.run_id]);
    expect(await claimRun(account.p.organizationId, run.run_id)).toBeNull();
    const result = await row(run.run_id);
    expect(result.result).toMatchObject({
      failure_code: 'queue_expired',
      persistence_status: 'not_required',
    });
    expect(result.started_at).toBeNull();
  });
  it('does not reclaim an active run when a duplicate dispatch job arrives', async () => {
    const run = await queued();
    const claimed = await claimRun(account.p.organizationId, run.run_id);
    expect(claimed?.status).toBe('provisioning');
    expect(await claimRun(account.p.organizationId, run.run_id)).toBeNull();
    expect((await row(run.run_id)).lease_generation).toBe(claimed!.lease_generation);
  });
  it('accepts only one answer to an input request under concurrent submission', async () => {
    const run = await queued(),
      inputId = id();
    await query("UPDATE runs SET status='waiting_for_input',input_request=$2 WHERE id=$1", [
      run.run_id,
      { id: inputId },
    ]);
    const results = await Promise.allSettled(
      ['first', 'second'].map((answer) =>
        transaction(account.p.organizationId, (tx) =>
          submitInput(tx, account.p, run.run_id, { input_request_id: inputId, answer: { text: answer } }),
        ),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'input_already_answered' });
    expect(['first', 'second']).toContain((await row(run.run_id)).input_request?.answer?.text);
  });
  it('rejects a stale input request without replacing the pending question', async () => {
    const run = await queued(),
      inputId = id();
    await query("UPDATE runs SET status='waiting_for_input',input_request=$2 WHERE id=$1", [
      run.run_id,
      { id: inputId },
    ]);
    await expect(
      transaction(account.p.organizationId, (tx) =>
        submitInput(tx, account.p, run.run_id, { input_request_id: id(), answer: { text: 'stale' } }),
      ),
    ).rejects.toMatchObject({ code: 'input_expired' });
    expect((await row(run.run_id)).input_request).toEqual({ id: inputId });
  });
  it('rejects input after a run has completed', async () => {
    const run = await queued(),
      inputId = id();
    await query("UPDATE runs SET status='succeeded',completed_at=now(),input_request=$2 WHERE id=$1", [
      run.run_id,
      { id: inputId },
    ]);
    await expect(
      transaction(account.p.organizationId, (tx) =>
        submitInput(tx, account.p, run.run_id, { input_request_id: inputId, answer: { text: 'too late' } }),
      ),
    ).rejects.toMatchObject({ code: 'input_expired' });
  });

  it('rejects input after cancellation is requested without recording an answer', async () => {
    const run = await queued(),
      inputId = id();
    await query("UPDATE runs SET status='waiting_for_input',input_request=$2 WHERE id=$1", [
      run.run_id,
      { id: inputId },
    ]);
    await transaction(account.p.organizationId, (tx) => cancelRun(tx, account.p, run.run_id));
    await expect(
      transaction(account.p.organizationId, (tx) =>
        submitInput(tx, account.p, run.run_id, { input_request_id: inputId, answer: { text: 'too late' } }),
      ),
    ).rejects.toMatchObject({ status: 409, code: 'input_expired' });
    expect((await row(run.run_id)).input_request).toEqual({ id: inputId });
    expect(
      (await query("SELECT id FROM run_events WHERE run_id=$1 AND type='input.received'", [run.run_id]))
        .rowCount,
    ).toBe(0);
  });
});
