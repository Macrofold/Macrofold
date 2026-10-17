import pg from 'pg';
import { config } from '../core/src/config';
import { capacitySetting } from '../core/src/capacity';
import { queryTimeoutMs, statementTimeoutMs as defaultStatementTimeoutMs } from './timeouts';
import {
  acquireWithin,
  budgetedClient,
  DatabaseBudgetError,
  remainingDatabaseMs,
  TransactionCommitUnknownError,
  TransactionRolledBackError,
} from './budget';
export { DatabaseBudgetError, TransactionCommitUnknownError, TransactionRolledBackError } from './budget';
export type Tx = pg.PoolClient;
const commitObservers = new WeakMap<Tx, (() => void)[]>();
/** Non-authoritative, synchronous notifications only. External I/O belongs in
 * the observer's bounded exporter, never inside the SQL transaction. */
export function afterCommit(tx: Tx, callback: () => void) {
  const observers = commitObservers.get(tx);
  if (!observers) throw new Error('Commit observers require a managed transaction.');
  observers.push(callback);
}
const globals = globalThis as unknown as {
  platformPool?: pg.Pool;
  authPool?: pg.Pool;
  credentialPool?: pg.Pool;
};
// A lock or lost connection must return control to the bounded recovery path.
// The server stops the statement before the client's wire deadline expires.
const databaseTimeouts = {
  connectionTimeoutMillis: capacitySetting('DATABASE_ACQUIRE_TIMEOUT_MS', 30_000, 60_000),
  query_timeout: queryTimeoutMs,
};
export const pool = (globals.platformPool ||= new pg.Pool({
  connectionString: config.databaseUrl,
  // Hosted pooled calibration benefits from 80; larger pools consume shared
  // database capacity across replicas. See docs/engineering/capacity/upper-bounds.md.
  max: capacitySetting('DATABASE_POOL_SIZE', 80, 1000),
  idleTimeoutMillis: 10000,
  ...databaseTimeouts,
}));
// Better Auth owns its own non-tenant schema; domain transactions use a separate role/context.
export const authPool = (globals.authPool ||= new pg.Pool({
  connectionString: process.env.AUTH_DATABASE_URL || config.databaseUrl,
  max: capacitySetting('AUTH_DATABASE_POOL_SIZE', 20, 1000),
  ...databaseTimeouts,
  options: '-c search_path=auth,public',
}));
// OAuth refresh must commit independently of the caller's resource transaction. Sharing
// its pool can exhaust every connection with callers waiting for a nested refresh.
export const credentialPool = (globals.credentialPool ||= new pg.Pool({
  connectionString: config.databaseUrl,
  max: capacitySetting('CREDENTIAL_DATABASE_POOL_SIZE', 32, 1000),
  idleTimeoutMillis: 10000,
  ...databaseTimeouts,
}));
export async function transaction<T>(
  organization: string | null,
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return transact(pool, organization, fn, options.exclusiveStorage ? 'exclusive' : 'shared', options);
}
export type TransactionOptions = {
  exclusiveStorage?: boolean;
  statementTimeoutMs?: number;
  /** Absolute cumulative deadline, including pool checkout, setup, locks and commit. */
  deadlineAtMs?: number;
};
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
  options: TransactionOptions = {},
) {
  const { statementTimeoutMs, deadlineAtMs } = options;
  if (
    statementTimeoutMs !== undefined &&
    (!Number.isSafeInteger(statementTimeoutMs) ||
      statementTimeoutMs < 1 ||
      statementTimeoutMs > defaultStatementTimeoutMs)
  )
    throw new RangeError('The statement deadline must be between 1 and 60000 milliseconds.');
  if (deadlineAtMs !== undefined && !Number.isFinite(deadlineAtMs))
    throw new RangeError('The database deadline must be a finite absolute timestamp.');
  const client =
    deadlineAtMs === undefined ? await connections.connect() : await acquireWithin(connections, deadlineAtMs);
  const tx = deadlineAtMs === undefined ? client : budgetedClient(client, deadlineAtMs);
  const observers: (() => void)[] = [];
  commitObservers.set(tx, observers);
  let committed = false;
  let committing = false;
  let releaseError: Error | undefined;
  try {
    await tx.query('BEGIN');
    // Apply before lock acquisition too, so bounded metadata readers cannot wait
    // indefinitely behind storage maintenance while their streams expire.
    if (statementTimeoutMs !== undefined || deadlineAtMs !== undefined) {
      const serverCeiling = Math.min(
        statementTimeoutMs ?? defaultStatementTimeoutMs,
        deadlineAtMs === undefined ? defaultStatementTimeoutMs : remainingDatabaseMs(deadlineAtMs),
      );
      await tx.query(
        "SELECT set_config('statement_timeout',$1,true),set_config('app.organization_id',$2,true)",
        [String(serverCeiling), organization || ''],
      );
    } else await tx.query("SELECT set_config('app.organization_id', $1, true)", [organization || '']);
    // Destructive storage maintenance excludes all tenant resource transactions. Ordinary
    // reads/writes share this lock; long-lived agent execution is also protected by its active run row.
    if (organization && storageLock)
      await tx.query(
        `SELECT ${storageLock === 'exclusive' ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}(hashtextextended($1,0))`,
        [`storage:${organization}`],
      );
    const result = await fn(tx);
    // Expiry before issuing COMMIT is a known rollback path. Only failures
    // after the actual commit attempt create an ambiguous admission outcome.
    const commit =
      deadlineAtMs === undefined
        ? 'COMMIT'
        : { text: 'COMMIT', query_timeout: remainingDatabaseMs(deadlineAtMs) };
    committing = true;
    const outcome = await client.query(commit);
    if (outcome.command !== 'COMMIT') {
      committing = false;
      throw new TransactionRolledBackError();
    }
    committed = true;
    return result;
  } catch (error) {
    if (committing) {
      releaseError = new Error('Commit acknowledgment failed.');
      throw new TransactionCommitUnknownError(error);
    }
    try {
      // Cleanup gets its own short wire deadline; it cannot run customer work.
      const rollback = deadlineAtMs === undefined ? 'ROLLBACK' : { text: 'ROLLBACK', query_timeout: 100 };
      await client.query(rollback);
      if (error instanceof DatabaseBudgetError) error.rollbackConfirmed = true;
    } catch {
      releaseError = new Error('Transaction rollback acknowledgment failed.');
    }
    throw error;
  } finally {
    commitObservers.delete(tx);
    client.release(releaseError);
    if (committed)
      for (const observer of observers) {
        try {
          observer();
        } catch {
          console.warn(JSON.stringify({ code: 'commit_observer_failed' }));
        }
      }
  }
}

/** Fixed, content-free reporting reads can use the pool without opening a
 * tenant transaction. Callers must never use this to bypass resource RLS. */
export async function boundedQuery<Row extends pg.QueryResultRow>(
  text: string,
  values: unknown[],
  options: { deadlineAtMs: number; statementTimeoutMs: number },
) {
  // A transaction installs the server deadline without relying on unsupported
  // startup options on managed transaction poolers.
  return transaction(null, (tx) => tx.query<Row>(text, values), options);
}
export async function lock(tx: Tx, value: string) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [value]);
}

/** Background work can defer immediately instead of occupying a connection while
 * another claimant holds the same admission boundary. Ownership remains in SQL. */
export async function tryLock(tx: Tx, value: string): Promise<boolean> {
  const result = await tx.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired',
    [value],
  );
  return result.rows[0].acquired;
}
