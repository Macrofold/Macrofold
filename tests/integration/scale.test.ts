import { it, expect, afterAll } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { id } from '../../packages/core/src/crypto';
import { credit, reserve } from '../../packages/core/src/ledger';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('bounds concurrent bursts per credential, isolates neighbors, and records rejected attempts', async () => {
  const a = await fixtureAccount('Burst account'),
    b = await fixtureAccount('Neighbor account');
  const previous = process.env.API_RATE_LIMIT_PER_MINUTE;
  process.env.API_RATE_LIMIT_PER_MINUTE = '10';
  try {
    const call = (key: string) =>
      handleApi(new Request(config.origin + '/v1/me', { headers: { Authorization: 'Bearer ' + key } }));
    // Same minute bucket, concurrent requests through the real HTTP/domain/database path.
    const [burst, neighbor] = await Promise.all([
      Promise.all(Array.from({ length: 32 }, () => call(a.key))),
      Promise.all(Array.from({ length: 8 }, () => call(b.key))),
    ]);
    expect(burst.filter((r) => r.status === 200)).toHaveLength(10);
    expect(burst.filter((r) => r.status === 429)).toHaveLength(22);
    expect(neighbor.every((r) => r.status === 200)).toBe(true);
    expect(burst.find((r) => r.status === 429)?.headers.get('retry-after')).toBe('60');
    const rows = await pool.query(
      'SELECT status,count(*)::int AS n FROM api_requests WHERE organization_id=$1 GROUP BY status',
      [a.p.organizationId],
    );
    expect(Object.fromEntries(rows.rows.map((r) => [r.status, r.n]))).toEqual({ '200': 10, '429': 22 });
  } finally {
    if (previous === undefined) delete process.env.API_RATE_LIMIT_PER_MINUTE;
    else process.env.API_RATE_LIMIT_PER_MINUTE = previous;
  }
});
it('serializes 32 competing funding claims without overspending or leaking pooled tenant context', async () => {
  const a = await fixtureAccount('Budget burst'),
    b = await fixtureAccount('Budget isolation');
  await transaction(a.p.organizationId, (tx) => credit(tx, a.p.organizationId, 1000n, 'burst:' + id()));
  // Fixture signup creates its own local credits; reset the test to an exactly measured available amount.
  const balance = BigInt(
    (await pool.query('SELECT balance_micro_usd FROM organizations WHERE id=$1', [a.p.organizationId]))
      .rows[0].balance_micro_usd,
  );
  const amount = balance / 8n;
  const claims = await Promise.allSettled(
    Array.from({ length: 32 }, () =>
      transaction(a.p.organizationId, (tx) => reserve(tx, a.p.organizationId, amount)),
    ),
  );
  expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(8);
  const row = (
    await pool.query('SELECT reserved_micro_usd,balance_micro_usd FROM organizations WHERE id=$1', [
      a.p.organizationId,
    ])
  ).rows[0];
  expect(BigInt(row.reserved_micro_usd)).toBe(amount * 8n);
  expect(BigInt(row.reserved_micro_usd) <= BigInt(row.balance_micro_usd)).toBe(true);
  const leaks = await Promise.all(
    Array.from({ length: 32 }, () =>
      transaction(b.p.organizationId, (tx) =>
        tx.query('SELECT id FROM ledger WHERE organization_id=$1', [a.p.organizationId]),
      ),
    ),
  );
  expect(leaks.every((r) => r.rowCount === 0)).toBe(true);
});
it('shares global execution capacity across simultaneous tenants and keeps unclaimed work queued', async () => {
  const { admitRun } = await import('../../packages/core/src/runs');
  const { claimRun } = await import('../../packages/core/src/engine');
  const resources = await import('../../packages/core/src/resources');
  const { createWorkspace } = await import('../../packages/core/src/files');
  const accounts = await Promise.all(
    Array.from({ length: 4 }, (_, i) => fixtureAccount('Global capacity ' + i)),
  );
  const initial = Number(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM reporting.runs WHERE status IN ('provisioning','running','waiting_for_input','persisting')",
      )
    ).rows[0].n,
  );
  const before = process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
  process.env.GLOBAL_CONCURRENT_RUN_LIMIT = String(initial + 2);
  try {
    const admitted = await Promise.all(
      accounts.map((a) =>
        transaction(a.p.organizationId, async (tx) => {
          const project = await resources.create(tx, 'projects', a.p.organizationId, { name: 'Capacity' });
          const ws = await createWorkspace(tx, a.p, project.id, { name: 'main', branch: 'main' });
          return admitRun(tx, a.p, {
            workspace_id: String((ws.result as any).workspace_id),
            harness: 'codex',
            model: 'fixture-model',
            billing_mode: 'managed',
            prompt: 'Capacity fixture',
          });
        }),
      ),
    );
    let claimed = await Promise.all(admitted.map((r, i) => claimRun(accounts[i].p.organizationId, r.run_id)));
    // A targeted attempt can arrive before that organization's fair turn. Real
    // workers poll again; a single unordered Promise.all is not one dispatch cycle.
    for (let wave = 0; wave < accounts.length && claimed.filter(Boolean).length < 2; wave++)
      claimed = await Promise.all(
        admitted.map((r, i) => claimed[i] || claimRun(accounts[i].p.organizationId, r.run_id)),
      );
    expect(claimed.filter(Boolean)).toHaveLength(2);
    for (let i = 0; i < accounts.length; i++)
      await transaction(accounts[i].p.organizationId, async (tx) => {
        const run = (
          await tx.query('SELECT status,reservation_micro_usd FROM runs WHERE id=$1', [admitted[i].run_id])
        ).rows[0];
        expect(run.status).toBe(claimed[i] ? 'provisioning' : 'queued');
        // Test cleanup releases capacity/reservations without invoking a provider.
        const { settle } = await import('../../packages/core/src/ledger');
        await settle(
          tx,
          accounts[i].p.organizationId,
          admitted[i].run_id,
          BigInt(run.reservation_micro_usd),
          0n,
        );
        await tx.query("UPDATE runs SET status='cancelled',completed_at=now() WHERE id=$1", [
          admitted[i].run_id,
        ]);
        await tx.query("UPDATE dispatch_jobs SET state='done' WHERE resource_id=$1", [admitted[i].run_id]);
      });
  } finally {
    if (before === undefined) delete process.env.GLOBAL_CONCURRENT_RUN_LIMIT;
    else process.env.GLOBAL_CONCURRENT_RUN_LIMIT = before;
  }
});
it('can pause admission and signup without deleting existing customer data', async () => {
  const a = await fixtureAccount('Maintenance drain');
  const { admitRun } = await import('../../packages/core/src/runs');
  const { auth } = await import('../../packages/core/src/auth');
  const oldRun = process.env.RUN_ADMISSION_ENABLED,
    oldSignup = process.env.PUBLIC_SIGNUP_ENABLED;
  process.env.RUN_ADMISSION_ENABLED = 'false';
  process.env.PUBLIC_SIGNUP_ENABLED = 'false';
  try {
    await expect(
      transaction(a.p.organizationId, (tx) =>
        admitRun(tx, a.p, {
          harness: 'codex',
          model: 'fixture-model',
          billing_mode: 'managed',
          prompt: 'Denied before funding',
        }),
      ),
    ).rejects.toMatchObject({ code: 'admission_paused' });
    const email = id() + '@example.test';
    await expect(
      auth.api.signUpEmail({ body: { email, password: 'a-fixture-password-2026', name: 'Paused' } }),
    ).rejects.toThrow('Registration is temporarily paused');
    expect((await pool.query('SELECT id FROM auth."user" WHERE email=$1', [email])).rowCount).toBe(0);
    const response = await handleApi(
      new Request(config.origin + '/v1/me', { headers: { Authorization: 'Bearer ' + a.key } }),
    );
    expect(response.status).toBe(200);
  } finally {
    for (const [key, value] of [
      ['RUN_ADMISSION_ENABLED', oldRun],
      ['PUBLIC_SIGNUP_ENABLED', oldSignup],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});
