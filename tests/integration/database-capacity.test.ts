import { afterAll, expect, it } from 'vitest';
import pg from 'pg';
import { config } from '../../packages/core/src/config';
import { pool, authPool, credentialPool, credentialTransaction, transaction } from '../../packages/db';

afterAll(async () => {
  await Promise.all([pool.end(), authPool.end(), credentialPool.end()]);
});

it('bounds an exhausted application pool without blocking independent auth/credential commits, then recovers', async () => {
  const held = await Promise.all(Array.from({ length: pool.options.max! }, () => pool.connect()));
  try {
    const started = performance.now();
    const waiting = pool.query('SELECT 1');
    // Attach immediately: expiry must be an observed rejection, not an unhandled one.
    const rejected = expect(waiting).rejects.toThrow(/timeout/);
    expect((await authPool.query('SELECT 1 AS value')).rows[0].value).toBe(1);
    expect(
      await credentialTransaction('', async (tx) => (await tx.query('SELECT 1 AS value')).rows[0].value),
    ).toBe(1);
    await rejected;
    const elapsed = performance.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(pool.options.connectionTimeoutMillis! - 100);
    expect(pool.waitingCount).toBe(0);
    console.log(
      JSON.stringify({
        experiment: 'database-exhaustion',
        connections: held.length,
        deadline_ms: pool.options.connectionTimeoutMillis,
        elapsed_ms: Math.round(elapsed),
      }),
    );
  } finally {
    for (const client of held) client.release();
  }
  expect((await pool.query('SELECT 1 AS value')).rows[0].value).toBe(1);
}, 70000);

it('installs server deadlines for all pools and restores shorter transaction-local deadlines', async () => {
  // No Pool startup options: prove migrations installed the server-side defaults.
  const fresh = new pg.Client({ connectionString: config.databaseUrl });
  await fresh.connect();
  try {
    for (const connections of [pool, authPool, credentialPool, fresh]) {
      const result = await connections.query(`SELECT current_setting('statement_timeout') AS statement,
      current_setting('idle_in_transaction_session_timeout') AS idle`);
      expect(result.rows[0]).toEqual({ statement: '1min', idle: '2min' });
    }
  } finally {
    await fresh.end();
  }
  await expect(
    transaction(null, (tx) => tx.query('SELECT pg_sleep(1)'), { statementTimeoutMs: 50 }),
  ).rejects.toMatchObject({ code: '57014' });
  expect((await pool.query("SELECT current_setting('statement_timeout') AS value")).rows[0].value).toBe(
    '1min',
  );
});
