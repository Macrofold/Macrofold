import { afterAll, expect, it } from 'vitest';
import { afterCommit, pool, queryGroup, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';

afterAll(() => pool.end());

it('orders tenant setup and dependent statements on one assigned connection', async () => {
  const organization = id();
  const values = await transaction(organization, async (tx) => {
    await tx.query('CREATE TEMP TABLE query_group_fixture(value integer) ON COMMIT DROP');
    return queryGroup(tx, [
      { text: 'INSERT INTO query_group_fixture VALUES(7)' },
      { text: "SELECT value,current_setting('app.organization_id') AS tenant FROM query_group_fixture" },
    ]);
  });
  expect(values[1].rows).toEqual([{ value: 7, tenant: organization }]);
  expect(
    (await pool.query("SELECT current_setting('app.organization_id',true) AS tenant")).rows[0].tenant,
  ).not.toBe(organization);
});

it('drains a failed group before rollback, preserves no partial writes and never publishes commit hooks', async () => {
  const organization = id();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [organization, 'Query group fixture']);
  let notified = false;
  await expect(
    transaction(organization, async (tx) => {
      afterCommit(tx, () => {
        notified = true;
      });
      await queryGroup(tx, [
        { text: "UPDATE organizations SET name='must roll back' WHERE id=$1", values: [organization] },
        { text: 'SELECT 1/0' },
        { text: "UPDATE organizations SET name='must also roll back' WHERE id=$1", values: [organization] },
      ]);
    }),
  ).rejects.toMatchObject({ code: '22012' });
  expect(notified).toBe(false);
  expect(
    (
      await transaction(organization, (tx) =>
        tx.query('SELECT name FROM organizations WHERE id=$1', [organization]),
      )
    ).rows,
  ).toEqual([{ name: 'Query group fixture' }]);
});

it('enforces the cumulative deadline for queued statements and recovers the pool afterward', async () => {
  await expect(
    transaction(
      null,
      (tx) =>
        queryGroup(tx, [
          { text: 'SELECT pg_sleep(0.08)' },
          { text: 'SELECT pg_sleep(1)' },
          { text: 'SELECT 3' },
        ]),
      { deadlineAtMs: Date.now() + 500, statementTimeoutMs: 100 },
    ),
  ).rejects.toMatchObject({ phase: 'statement' });
  expect((await transaction(null, (tx) => tx.query('SELECT 4 AS value'))).rows[0].value).toBe(4);
});

it('rejects unmanaged, oversized and overlapping groups without losing the owning transaction', async () => {
  const raw = await pool.connect();
  try {
    await expect(queryGroup(raw, [{ text: 'SELECT 1' }])).rejects.toThrow('managed transaction');
  } finally {
    raw.release();
  }
  await transaction(null, async (tx) => {
    await expect(queryGroup(tx, [{ text: 'COMMIT' }])).rejects.toThrow('boundaries');
    await expect(
      queryGroup(
        tx,
        Array.from({ length: 65 }, () => ({ text: 'SELECT 1' })),
      ),
    ).rejects.toThrow('64 statements');
    const first = queryGroup(tx, [{ text: 'SELECT 3 AS value' }]);
    await expect(queryGroup(tx, [{ text: 'SELECT 4' }])).rejects.toThrow('overlap');
    expect((await first)[0].rows[0].value).toBe(3);
    expect((await tx.query('SELECT 5 AS value')).rows[0].value).toBe(5);
  });
});

it('discards a pipeline after a client wire timeout and never returns a poisoned client to the pool', async () => {
  // This installed-driver option is intentionally shorter than the server's
  // statement timeout, exercising its connection-destroy/drain failure path.
  const timed = { text: 'SELECT pg_sleep(1)', query_timeout: 20 };
  await expect(transaction(null, (tx) => queryGroup(tx, [timed, { text: 'SELECT 2' }]))).rejects.toThrow();
  expect((await transaction(null, (tx) => tx.query('SELECT 6 AS value'))).rows[0].value).toBe(6);
});
