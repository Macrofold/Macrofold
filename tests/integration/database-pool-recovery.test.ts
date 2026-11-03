import pg from 'pg';
import { afterAll, expect, it, vi } from 'vitest';
import { config } from '../../packages/core/src/config';
import { pool, authPool, credentialPool } from '../../packages/db';

afterAll(() => Promise.all([pool.end(), authPool.end(), credentialPool.end()]));

it.each([
  ['domain', pool],
  ['identity', authPool],
  ['credential', credentialPool],
] as const)('replaces an interrupted idle %s connection without crashing', async (name, connections) => {
  // Terminate only our own known backend inside the disposable wrapper database.
  expect(new URL(config.databaseUrl).pathname).toMatch(/^\/platform_test_/);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const terminator = new pg.Client({ connectionString: config.databaseUrl });
  try {
    const client = await connections.connect();
    let pid: number;
    try {
      pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    } finally {
      client.release();
    }
    expect(connections.idleCount).toBe(1);
    await terminator.connect();
    expect(
      (await terminator.query('SELECT pg_terminate_backend($1) AS terminated', [pid])).rows[0].terminated,
    ).toBe(true);
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          code: 'database_pool_unavailable',
          pool: name,
          error_type: 'Error',
          sqlstate: '57P01',
        }),
      ),
    );
    const replacement = await connections.query<{ pid: number; value: number }>(
      'SELECT pg_backend_pid() AS pid, 1 AS value',
    );
    expect(replacement.rows[0].pid).not.toBe(pid);
    expect(replacement.rows[0].value).toBe(1);
    expect(connections.totalCount).toBe(1);
    expect(connections.waitingCount).toBe(0);
  } finally {
    await terminator.end();
    warning.mockRestore();
  }
});
