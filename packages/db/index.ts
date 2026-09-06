import pg from 'pg';
import { config } from '../core/src/config';
export type Tx = pg.PoolClient;
const globals = globalThis as unknown as {
  platformPool?: pg.Pool;
  authPool?: pg.Pool;
  credentialPool?: pg.Pool;
};
export const pool = (globals.platformPool ||= new pg.Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
}));
// Better Auth owns its own non-tenant schema; domain transactions use a separate role/context.
export const authPool = (globals.authPool ||= new pg.Pool({
  connectionString: process.env.AUTH_DATABASE_URL || config.databaseUrl,
  max: 3,
  options: '-c search_path=auth,public',
}));
// OAuth refresh must commit independently of the caller's resource transaction. Sharing
// its pool can exhaust every connection with callers waiting for a nested refresh.
export const credentialPool = (globals.credentialPool ||= new pg.Pool({
  connectionString: config.databaseUrl,
  max: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
}));
export async function transaction<T>(
  organization: string | null,
  fn: (tx: Tx) => Promise<T>,
  options: { exclusiveStorage?: boolean } = {},
): Promise<T> {
  return transact(pool, organization, fn, options.exclusiveStorage ? 'exclusive' : 'shared');
}
/** Credential rows have no filesystem objects. A refresh must not reacquire its caller's
 * storage lock behind waiting garbage collection, which would create a lock cycle. */
export function credentialTransaction<T>(organization: string, fn: (tx: Tx) => Promise<T>) {
  return transact(credentialPool, organization, fn);
}
async function transact<T>(
  connections: pg.Pool,
  organization: string | null,
  fn: (tx: Tx) => Promise<T>,
  storageLock?: 'shared' | 'exclusive',
) {
  const tx = await connections.connect();
  try {
    await tx.query('BEGIN');
    await tx.query("SELECT set_config('app.organization_id', $1, true)", [organization || '']);
    // Destructive storage maintenance excludes all tenant resource transactions. Ordinary
    // reads/writes share this lock; long-lived agent execution is also protected by its active run row.
    if (organization && storageLock)
      await tx.query(
        `SELECT ${storageLock === 'exclusive' ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}(hashtextextended($1,0))`,
        [`storage:${organization}`],
      );
    const result = await fn(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}
export async function lock(tx: Tx, value: string) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [value]);
}
