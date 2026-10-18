import pg from 'pg';
import { channel } from 'node:diagnostics_channel';
import { beginDatabaseGroup, beginDatabaseTransaction } from './diagnostics';
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
const activeGroups = new WeakSet<Tx>();
const groupedQueries = channel('macrofold.database.group');
/** An active transaction generation, distinct even when a pooled client is reused. */
export function transactionIdentity(tx: Tx): object {
  const identity = commitObservers.get(tx);
  if (!identity) throw new Error('An active managed transaction is required.');
  return identity;
}
/** Submit a bounded, already ordered group on the transaction's assigned client.
 * This is for statements whose results need no intervening domain decision.
 * pg preserves submission order; every result drains before rollback or COMMIT.
 * See the execution-efficiency design's database round-trip contract. */
export async function queryGroup<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  tx: Tx,
  statements: readonly pg.QueryConfig[],
): Promise<pg.QueryResult<Row>[]> {
  if (
    statements.some(({ text }) =>
      /^\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|PREPARE\s+TRANSACTION)\b/i.test(text),
    )
  )
    throw new Error('Transaction boundaries belong to the managed transaction.');
  return submitQueryGroup<Row>(tx, statements);
}
async function submitQueryGroup<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  tx: Tx,
  statements: readonly pg.QueryConfig[],
): Promise<pg.QueryResult<Row>[]> {
  if (!commitObservers.has(tx)) throw new Error('Query groups require a managed transaction.');
  if (statements.length > 64) throw new RangeError('A query group is limited to 64 statements.');
  if (activeGroups.has(tx)) throw new Error('Query groups cannot overlap on one transaction.');
  // pg@8.23 exposes this public option; @types/pg has not declared it yet.
  const client = tx as Tx & { pipeline: boolean };
  const previous = client.pipeline;
  activeGroups.add(tx);
  client.pipeline = true;
  const started = groupedQueries.hasSubscribers ? performance.now() : undefined;
  const endMeasurement = beginDatabaseGroup(tx, statements.length);
  try {
    const results = await Promise.allSettled(statements.map(async (statement) => tx.query<Row>(statement)));
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return results.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  } finally {
    client.pipeline = previous;
    activeGroups.delete(tx);
    endMeasurement();
    if (started !== undefined)
      groupedQueries.publish({ statements: statements.length, started, ended: performance.now() });
  }
}
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
  const endMeasurement = beginDatabaseTransaction(client, tx);
  let committed = false;
  let committing = false;
  let rolledBack = false;
  let releaseError: Error | undefined;
  // pg destroys a timed-out pipeline and emits a client error after rejecting
  // its queries. The checked-out client has no pool idle listener at that point.
  // Own that event until release so the failure cannot escape as an uncaught
  // exception, and never return the broken socket to the pool.
  const onClientError = (error: Error) => {
    releaseError = error;
  };
  client.on('error', onClientError);
  try {
    // Apply before lock acquisition too, so bounded metadata readers cannot wait
    // indefinitely behind storage maintenance while their streams expire.
    const setup: pg.QueryConfig[] = [{ text: 'BEGIN' }];
    if (statementTimeoutMs !== undefined || deadlineAtMs !== undefined) {
      const serverCeiling = Math.min(
        statementTimeoutMs ?? defaultStatementTimeoutMs,
        deadlineAtMs === undefined ? defaultStatementTimeoutMs : remainingDatabaseMs(deadlineAtMs),
      );
      setup.push({
        text: "SELECT set_config('statement_timeout',$1,true),set_config('app.organization_id',$2,true)",
        values: [String(serverCeiling), organization || ''],
      });
    } else
      setup.push({
        text: "SELECT set_config('app.organization_id', $1, true)",
        values: [organization || ''],
      });
    // Destructive storage maintenance excludes all tenant resource transactions. Ordinary
    // reads/writes share this lock; long-lived agent execution is also protected by its active run row.
    if (organization && storageLock)
      setup.push({
        text: `SELECT ${storageLock === 'exclusive' ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}(hashtextextended($1,0))`,
        values: [`storage:${organization}`],
      });
    await submitQueryGroup(tx, setup);
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
      rolledBack = true;
      if (error instanceof DatabaseBudgetError) error.rollbackConfirmed = true;
    } catch {
      releaseError = new Error('Transaction rollback acknowledgment failed.');
    }
    throw error;
  } finally {
    commitObservers.delete(tx);
    endMeasurement?.(
      committed ? 'committed' : committing ? 'commit_unknown' : rolledBack ? 'rolled_back' : 'failed',
    );
    client.release(releaseError);
    client.removeListener('error', onClientError);
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
  await tx.query(lockQuery(value));
}
export function lockQuery(value: string): pg.QueryConfig {
  return { text: 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', values: [value] };
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
