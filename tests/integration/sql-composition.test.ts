import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { pool, authPool, transaction, lock } from '../../packages/db';
import { fixtureAccount, retireFixtureRuns } from '../fixtures/account';
import { id, sha256 } from '../../packages/core/src/crypto';
import { config } from '../../packages/core/src/config';
import { prepareInference } from '../../packages/core/src/inferences';
import { credit, expireCredits, settle } from '../../packages/core/src/ledger';
import {
  loadModelSettlement,
  settleModelRequest,
  settleModelRequestInTransaction,
  settleModelRequestForCompletion,
  consumeSettlementRunControl,
} from '../../packages/core/src/model-gateway';
import type { RuntimeCapability } from '../../packages/core/src/runtime-auth';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
const model = {
  id: 'composed-accounting-fixture',
  name: 'Composed accounting fixture',
  provider: 'anthropic',
  harnesses: ['claude_code'],
  input_micro_usd_per_million: '1000000',
  output_micro_usd_per_million: '2000000',
  enabled: true,
};
const usage = { input: 10, output: 5, cached: 0, cacheWrite: 0, complete: true };
beforeAll(async () => {
  account = await fixtureAccount('SQL composition');
});
afterAll(async () => {
  await retireFixtureRuns(account.p.organizationId);
  await Promise.all([pool.end(), authPool.end()]);
});
async function requestFixture() {
  const run = id(),
    request = id();
  await transaction(account.p.organizationId, async (tx) => {
    await tx.query(
      `INSERT INTO runs(id,organization_id,kind,status,config,lease_generation,deadline,model_reserved_micro_usd)
       VALUES($1,$2,'inference','running',$3,1,now()+interval '1 minute',100)`,
      [run, account.p.organizationId, { executor_version: '1', definition: {}, context: {} }],
    );
    await tx.query(
      `INSERT INTO gateway_requests(id,organization_id,run_id,lease_generation,model,provider,billing_mode,status,reserved_micro_usd)
       VALUES($1,$2,$3,1,$4,'anthropic','managed','in_flight',100)`,
      [request, account.p.organizationId, run, model.id],
    );
  });
  const capability: RuntimeCapability = {
    purpose: 'runtime',
    organization: account.p.organizationId,
    run,
    lease: '1',
    expires: Date.now() + 60_000,
  };
  return { run, request, capability };
}
async function facts(run: string) {
  return transaction(account.p.organizationId, async (tx) => {
    const current = (
      await tx.query(
        `SELECT budget_used_micro_usd,cost_micro_usd,model_reserved_micro_usd
      FROM runs WHERE id=$1`,
        [run],
      )
    ).rows[0];
    const rows = (
      await tx.query('SELECT cost_micro_usd,input_tokens,output_tokens FROM model_usage WHERE run_id=$1', [
        run,
      ])
    ).rows;
    return { current, rows };
  });
}
it('consumes locked model state once and preserves idempotent later accounting', async () => {
  const fixture = await requestFixture();
  await transaction(account.p.organizationId, async (tx) => {
    const locked = await loadModelSettlement(tx, fixture.capability, fixture.request);
    if (!locked) throw new Error('Missing fixture accounting row');
    expect(
      await settleModelRequestInTransaction(
        tx,
        fixture.capability,
        fixture.request,
        model,
        usage,
        false,
        undefined,
        locked,
      ),
    ).toMatchObject({ charged_micro_usd: '20', provisional: false });
    await expect(
      settleModelRequestInTransaction(
        tx,
        fixture.capability,
        fixture.request,
        model,
        usage,
        false,
        undefined,
        locked,
      ),
    ).rejects.toMatchObject({ code: 'billing_state_stale' });
  });
  expect(await settleModelRequest(fixture.capability, fixture.request, model, usage)).toMatchObject({
    charged_micro_usd: '20',
  });
  expect(await facts(fixture.run)).toEqual({
    current: { budget_used_micro_usd: '20', cost_micro_usd: '20', model_reserved_micro_usd: '0' },
    rows: [{ cost_micro_usd: '20', input_tokens: '10', output_tokens: '5' }],
  });
});
it('rejects old transaction state and invalidates earlier same-transaction snapshots after reloading', async () => {
  const fixture = await requestFixture();
  const previous = await transaction(account.p.organizationId, (tx) =>
    loadModelSettlement(tx, fixture.capability, fixture.request),
  );
  if (!previous) throw new Error('Missing fixture accounting row');
  await expect(
    transaction(account.p.organizationId, (tx) =>
      settleModelRequestInTransaction(
        tx,
        fixture.capability,
        fixture.request,
        model,
        usage,
        false,
        undefined,
        previous,
      ),
    ),
  ).rejects.toMatchObject({ code: 'billing_state_stale' });
  expect((await facts(fixture.run)).rows).toEqual([]);
  await transaction(account.p.organizationId, async (tx) => {
    const old = await loadModelSettlement(tx, fixture.capability, fixture.request);
    const current = await loadModelSettlement(tx, fixture.capability, fixture.request);
    if (!old || !current) throw new Error('Missing fixture accounting row');
    await expect(
      settleModelRequestInTransaction(
        tx,
        fixture.capability,
        fixture.request,
        model,
        usage,
        false,
        undefined,
        old,
      ),
    ).rejects.toMatchObject({ code: 'billing_state_stale' });
    await settleModelRequestInTransaction(
      tx,
      fixture.capability,
      fixture.request,
      model,
      usage,
      false,
      undefined,
      current,
    );
  });
  expect((await facts(fixture.run)).current).toEqual({
    budget_used_micro_usd: '20',
    cost_micro_usd: '20',
    model_reserved_micro_usd: '0',
  });
});

it('observes the fresh clock, metering cancellation and usage event after composed settlement', async () => {
  const fixture = await requestFixture();
  await transaction(account.p.organizationId, async (tx) => {
    const initial = await tx.query<{ deadline_passed: boolean }>(
      `UPDATE runs SET deadline=clock_timestamp()+interval '1 millisecond' WHERE id=$1
       RETURNING deadline<=clock_timestamp() AS deadline_passed`,
      [fixture.run],
    );
    expect(initial.rows[0].deadline_passed).toBe(false);
    await tx.query('SELECT pg_sleep(0.01)');
    const result = await settleModelRequestForCompletion(tx, fixture.capability, fixture.request, model, {
      ...usage,
      input: 101,
    });
    expect(result.billing).toMatchObject({ charged_micro_usd: '100', bound_breached: true });
    if (!result.control) throw new Error('Missing composed control snapshot');
    expect(
      consumeSettlementRunControl(tx, account.p.organizationId, fixture.run, result.control),
    ).toMatchObject({
      deadline_passed: true,
      cancel_requested: true,
      budget_used_micro_usd: '100',
      cost_micro_usd: '100',
      model_reserved_micro_usd: '0',
      event_sequence: '2',
    });
    expect(() =>
      consumeSettlementRunControl(tx, account.p.organizationId, fixture.run, result.control!),
    ).toThrow(expect.objectContaining({ code: 'billing_state_stale' }));
  });
});

it('binds composed control to its transaction and Run and leaves settled replay on the fresh-read path', async () => {
  const fixture = await requestFixture();
  const result = await transaction(account.p.organizationId, async (tx) => {
    const result = await settleModelRequestForCompletion(
      tx,
      fixture.capability,
      fixture.request,
      model,
      usage,
    );
    if (!result.control) throw new Error('Missing composed control snapshot');
    expect(() => consumeSettlementRunControl(tx, account.p.organizationId, id(), result.control!)).toThrow(
      expect.objectContaining({ code: 'billing_state_stale' }),
    );
    return result;
  });
  await transaction(account.p.organizationId, async (tx) => {
    expect(() =>
      consumeSettlementRunControl(tx, account.p.organizationId, fixture.run, result.control!),
    ).toThrow(expect.objectContaining({ code: 'billing_state_stale' }));
    const replay = await settleModelRequestForCompletion(
      tx,
      fixture.capability,
      fixture.request,
      model,
      usage,
    );
    expect(replay.control).toBeUndefined();
    expect(replay.billing).toMatchObject({ charged_micro_usd: '20' });
  });
  expect((await facts(fixture.run)).rows).toHaveLength(1);
});

it('protects credits expiring during the later capacity wait using the account-locked decision', async () => {
  const expiring = await fixtureAccount('Expiry during capacity wait');
  const org = expiring.p.organizationId;
  const original = { ...config };
  let release = () => {};
  let holder: Promise<void> | undefined;
  let candidate:
    Promise<import('../../packages/core/src/api-types').ApiResult<'createInference'>> | undefined;
  try {
    const key = (
      await transaction(org, (tx) =>
        tx.query<{ id: string }>('SELECT id FROM api_keys WHERE organization_id=$1 AND key_hash=$2', [
          org,
          sha256(expiring.key),
        ]),
      )
    ).rows[0];
    const principal = { ...expiring.p, id: key.id, kind: 'api_key' as const };
    config.allowPaid = true;
    config.execution = 'docker';
    vi.stubEnv('TYPESAFE_API_KEY', 'fixture-key-no-provider-account');
    const prepared = await prepareInference(
      principal,
      {
        model_binding: { provider: 'typesafe', model: 'jev-1.13.0', billing_mode: 'managed' },
        input: {
          state: 'A local fixture',
          questions: {
            route: {
              type: 'choice',
              instructions: 'Choose the fixture',
              criteria: { yes: 'Fixture', no: 'Other' },
            },
          },
        },
        limits: { max_cost_micro_usd: '1000', max_output_tokens: 100, timeout_seconds: 30 },
      },
      'inference',
      true,
    );
    const expiry = await transaction(org, async (tx) => {
      const date = (await tx.query<{ at: Date }>("SELECT clock_timestamp()+interval '2 seconds' AS at"))
        .rows[0].at;
      await credit(tx, org, 1000n, `fixture:${id()}`, 'included_credits', date);
      return date;
    });
    let acquired = () => {};
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    holder = transaction(null, async (tx) => {
      await lock(tx, 'capacity:global');
      acquired();
      await gate;
    });
    await ready;
    let candidatePid = 0;
    candidate = transaction(org, async (tx) => {
      candidatePid = (await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      return prepared.commit(tx, principal);
    });
    await expect
      .poll(async () =>
        candidatePid
          ? (await pool.query<{ n: number }>('SELECT cardinality(pg_blocking_pids($1)) AS n', [candidatePid]))
              .rows[0].n
          : 0,
      )
      .toBeGreaterThan(0);
    await expect
      .poll(
        async () =>
          (
            await pool.query<{ expired: boolean }>('SELECT clock_timestamp()>=$1::timestamptz AS expired', [
              expiry,
            ])
          ).rows[0].expired,
        { timeout: 5000 },
      )
      .toBe(true);
    release();
    await holder;
    const receipt = await candidate;
    expect(receipt.status).toBe('running');
    expect(await transaction(org, (tx) => expireCredits(tx, org))).toBe(0n);
    await transaction(org, async (tx) => {
      const wallet = (
        await tx.query('SELECT balance_micro_usd,reserved_micro_usd FROM organizations WHERE id=$1', [org])
      ).rows[0];
      expect(wallet).toEqual({ balance_micro_usd: '1000', reserved_micro_usd: '1000' });
      await settle(tx, org, receipt.run_id, 1000n, 0n);
      expect(
        (await tx.query('SELECT balance_micro_usd,reserved_micro_usd FROM organizations WHERE id=$1', [org]))
          .rows[0],
      ).toEqual({ balance_micro_usd: '0', reserved_micro_usd: '0' });
      expect(
        (await tx.query('SELECT journal_id FROM ledger GROUP BY journal_id HAVING sum(amount_micro_usd)<>0'))
          .rows,
      ).toEqual([]);
    });
    await prepared.dispose();
  } finally {
    release();
    await holder;
    await candidate?.catch(() => {});
    Object.assign(config, original);
    vi.unstubAllEnvs();
    await retireFixtureRuns(org);
  }
}, 15000);
