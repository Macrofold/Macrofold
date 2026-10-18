import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { DatabaseMeasurement, PerformancePool, PerformanceTicket } from '../contracts/performance';

type TransactionMeasurement = {
  ticket: PerformanceTicket;
  started: number;
  id: string;
  pool?: PerformancePool;
  group?: number;
};
const transactions = new WeakMap<pg.PoolClient, TransactionMeasurement>();
const clientPools = new WeakMap<pg.PoolClient, PerformancePool>();
let capture: (() => PerformanceTicket | undefined) | undefined;
let groupId = 0;
function capturedTicket() {
  try {
    return capture?.();
  } catch {
    return undefined;
  }
}
const noop = () => {};
function record(ticket: PerformanceTicket | undefined, measurement: DatabaseMeasurement) {
  try {
    ticket?.record(measurement);
  } catch {
    /* Optional diagnostics cannot affect SQL. */
  }
}
export function beginDatabaseTransaction(client: pg.PoolClient, tx: pg.PoolClient) {
  const ticket = capturedTicket();
  if (!ticket) return undefined;
  const state: TransactionMeasurement = {
    ticket,
    started: performance.now(),
    id: randomUUID(),
    pool: clientPools.get(client),
  };
  transactions.set(client, state);
  transactions.set(tx, state);
  return (outcome: NonNullable<DatabaseMeasurement['outcome']>) => {
    transactions.delete(client);
    transactions.delete(tx);
    record(ticket, {
      kind: 'transaction',
      durationMs: performance.now() - state.started,
      outcome,
      transactionId: state.id,
      pool: state.pool,
    });
  };
}
export function beginDatabaseGroup(tx: pg.PoolClient, statements: number) {
  const state = capture ? transactions.get(tx) : undefined;
  if (!state) return noop;
  const ticket = capturedTicket(),
    started = ticket ? performance.now() : 0;
  const id = ++groupId;
  state.group = id;
  return () => {
    state.group = undefined;
    if (ticket)
      record(ticket, {
        kind: 'group',
        durationMs: performance.now() - started,
        groupId: id,
        transactionId: state.id,
        pool: state.pool,
        statements,
      });
  };
}

/** Instance-only pg@8 adapter. Capture context at submission, never from a later
 * driver callback. Unsupported custom Query forms pass through untouched. */
export function observeDatabasePools(
  pools: readonly (readonly [pg.Pool, PerformancePool])[],
  getTicket: () => PerformanceTicket | undefined,
  unscoped?: (kind: 'query' | 'checkout', pool: PerformancePool) => void,
) {
  if (capture) throw new Error('Database diagnostics already configured.');
  capture = getTicket;
  let active = true;
  const countUnscoped = (kind: 'query' | 'checkout', pool: PerformancePool) => {
    try {
      if (active) unscoped?.(kind, pool);
    } catch {}
  };
  const clients = new Map<
    pg.PoolClient,
    { query: pg.PoolClient['query']; wrapped: pg.PoolClient['query']; ended: () => void }
  >();
  const originalPools = new Map<pg.Pool, { connect: pg.Pool['connect']; wrapped: pg.Pool['connect'] }>();
  const install = (client: pg.PoolClient, pool: PerformancePool) => {
    if (!active || clients.has(client)) return;
    const original = client.query;
    // pg's declarations express overloads; the adapter preserves them at this
    // single verified interop boundary (Promise and callback tests cover both).
    const wrapped = function (this: pg.PoolClient, ...args: unknown[]): unknown {
      const ticket = active ? capturedTicket() : undefined;
      if (!ticket) {
        countUnscoped('query', pool);
        return Reflect.apply(original, this, args);
      }
      const first = args[0];
      if (first && typeof first === 'object' && ('submit' in first || 'callback' in first)) {
        record(ticket, { kind: 'unsupported_driver_form', durationMs: 0, pool });
        return Reflect.apply(original, this, args);
      }
      const context = transactions.get(client);
      const group = context?.group;
      const started = performance.now();
      let done = false;
      const values: unknown =
        first && typeof first === 'object' && 'values' in first ? first.values : args[1];
      let parameterBytes = 0,
        unknownParameters = 0;
      if (Array.isArray(values))
        for (const value of values) {
          if (Buffer.isBuffer(value)) parameterBytes += value.length;
          else if (typeof value === 'string' && value.length <= 4096)
            parameterBytes += Buffer.byteLength(value);
          else if (value !== null && value !== undefined) unknownParameters++;
        }
      const text =
        typeof first === 'string'
          ? first
          : first && typeof first === 'object' && 'text' in first
            ? first.text
            : '';
      const kind = text === 'COMMIT' ? 'commit' : text === 'ROLLBACK' ? 'rollback' : undefined;
      const finish = (result?: unknown) => {
        if (done) return;
        done = true;
        const durationMs = performance.now() - started;
        const rows =
          result && typeof result === 'object' && 'rowCount' in result && typeof result.rowCount === 'number'
            ? result.rowCount
            : undefined;
        record(ticket, {
          kind: 'query',
          durationMs,
          grouped: group !== undefined,
          rows,
          parameterBytes,
          unknownParameters,
          pool,
          transactionId: context?.id,
          groupId: group,
        });
        if (kind) record(ticket, { kind, durationMs, pool, transactionId: context?.id });
      };
      const callbackIndex = typeof args[args.length - 1] === 'function' ? args.length - 1 : -1;
      if (callbackIndex >= 0) {
        const callback = args[callbackIndex];
        args[callbackIndex] = function (this: unknown, ...result: unknown[]) {
          finish(result[1]);
          return Reflect.apply(callback as (...args: unknown[]) => unknown, this, result);
        };
      }
      try {
        const result: unknown = Reflect.apply(original, this, args);
        if (callbackIndex >= 0) return result;
        if (result instanceof Promise)
          return result.then(
            (value: unknown) => {
              finish(value);
              return value;
            },
            (error: unknown) => {
              finish();
              throw error;
            },
          );
        finish();
        return result;
      } catch (error) {
        finish();
        throw error;
      }
    } as pg.PoolClient['query'];
    const ended = () => {
      clients.delete(client);
      clientPools.delete(client);
    };
    client.query = wrapped;
    client.once('end', ended);
    clientPools.set(client, pool);
    clients.set(client, { query: original, wrapped, ended });
  };
  for (const [pool, poolKind] of pools) {
    const original = pool.connect;
    const wrapped = function (this: pg.Pool, ...args: unknown[]): unknown {
      const ticket = active ? capturedTicket() : undefined,
        started = ticket ? performance.now() : 0;
      const finish = (client?: pg.PoolClient) => {
        if (client) install(client, poolKind);
        if (!ticket) countUnscoped('checkout', poolKind);
        if (ticket)
          record(ticket, {
            kind: 'checkout',
            durationMs: performance.now() - started,
            pool: poolKind,
            checkedOut: pool.totalCount - pool.idleCount,
            waiting: pool.waitingCount,
          });
      };
      const callback = args[0];
      if (typeof callback === 'function') {
        args[0] = function (
          this: unknown,
          error: Error | undefined,
          client: pg.PoolClient | undefined,
          release: unknown,
        ) {
          finish(client);
          return Reflect.apply(callback, this, [error, client, release]);
        };
        return Reflect.apply(original, this, args);
      }
      const pending: Promise<pg.PoolClient> = Reflect.apply(original, this, args);
      return pending.then(
        (client) => {
          finish(client);
          return client;
        },
        (error: unknown) => {
          finish();
          throw error;
        },
      );
    } as pg.Pool['connect'];
    pool.connect = wrapped;
    originalPools.set(pool, { connect: original, wrapped });
  }
  return () => {
    if (!active) return;
    active = false;
    capture = undefined;
    let conflict = false;
    for (const [pool, saved] of originalPools) {
      if (pool.connect === saved.wrapped) pool.connect = saved.connect;
      else conflict = true;
    }
    for (const [client, saved] of clients) {
      if (client.query === saved.wrapped) client.query = saved.query;
      else conflict = true;
      client.removeListener('end', saved.ended);
      clientPools.delete(client);
    }
    clients.clear();
    originalPools.clear();
    if (conflict)
      try {
        console.warn(JSON.stringify({ code: 'performance_profile_detach_conflict' }));
      } catch {
        /* A newer instrumentation owner is preserved; diagnostics stay optional. */
      }
  };
}
