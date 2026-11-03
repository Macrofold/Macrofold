import pg from 'pg';
import { expect, it, vi } from 'vitest';
import { observePoolErrors } from '../../packages/db/error-diagnostics';

it('owns pool failures once across module reloads without exposing connection details', async () => {
  const pool = new pg.Pool();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    observePoolErrors(pool, 'domain');
    observePoolErrors(pool, 'domain');
    vi.resetModules();
    const reloaded = await import('../../packages/db/error-diagnostics');
    reloaded.observePoolErrors(pool, 'domain');
    expect(pool.listenerCount('error')).toBe(1);
    pool.emit('error', Object.assign(new Error('private database URL'), { code: 'ECONNRESET' }));
    expect(warning).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({
        code: 'database_pool_unavailable',
        pool: 'domain',
        error_type: 'Error',
        network_code: 'ECONNRESET',
      }),
    );
  } finally {
    warning.mockRestore();
    await pool.end();
  }
});
