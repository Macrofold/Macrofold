import { afterAll, expect, it } from 'vitest';
import { pool, authPool, credentialPool, credentialTransaction } from '../../packages/db';

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
