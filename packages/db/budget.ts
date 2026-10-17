import type pg from 'pg';

export type DatabaseBudgetPhase = 'acquire' | 'statement';

/** A failed COMMIT acknowledgment is never evidence that admission rolled back. */
export class TransactionCommitUnknownError extends Error {
  constructor(cause: unknown) {
    super('The database commit outcome is unknown.', { cause });
  }
}

/** PostgreSQL answers COMMIT with ROLLBACK when its transaction was aborted. */
export class TransactionRolledBackError extends Error {
  readonly rollbackConfirmed = true;
  constructor() {
    super('The transaction was rolled back instead of committed.');
  }
}

export class DatabaseBudgetError extends Error {
  rollbackConfirmed = false;
  constructor(
    public readonly phase: DatabaseBudgetPhase,
    cause?: unknown,
  ) {
    super('The database operation exhausted its time budget.', { cause });
    this.rollbackConfirmed = phase === 'acquire';
  }
}

export function remainingDatabaseMs(deadlineAtMs: number) {
  const remaining = Math.floor(deadlineAtMs - Date.now());
  if (remaining < 1) throw new DatabaseBudgetError('statement');
  return remaining;
}

/** pg has no per-checkout cancellation. Release a client granted after our
 * deadline instead of leaking it or letting timed-out work enter a transaction. */
export async function acquireWithin(connections: pg.Pool, deadlineAtMs: number) {
  const remaining = Math.floor(deadlineAtMs - Date.now());
  if (remaining < 1) throw new DatabaseBudgetError('acquire');
  let expired = false;
  let timer: NodeJS.Timeout | undefined;
  const acquisition = connections.connect().then((client) => {
    if (expired) {
      client.release();
      throw new DatabaseBudgetError('acquire');
    }
    return client;
  });
  try {
    return await Promise.race([
      acquisition,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new DatabaseBudgetError('acquire'));
        }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Promise-based managed transactions share one cumulative wire budget. The
 * transaction installs a bounded server ceiling once; a missed wire deadline
 * cannot issue COMMIT and discards the client if rollback is not acknowledged.
 * This avoids doubling every hot-path SQL round trip just to reset a deadline. */
export function budgetedClient(client: pg.PoolClient, deadlineAtMs: number) {
  const query = client.query.bind(client);
  return new Proxy(client, {
    get(target, key, receiver) {
      if (key !== 'query') return Reflect.get(target, key, receiver);
      return async (input: string | pg.QueryConfig, values?: unknown[]) => {
        try {
          const request = typeof input === 'string' ? { text: input, values } : { ...input };
          // Installed pg supports this per-query option; @types/pg declares it
          // only on ClientConfig. Structural assignment preserves its types.
          const bounded = { ...request, query_timeout: remainingDatabaseMs(deadlineAtMs) };
          return await query(bounded);
        } catch (cause) {
          if (cause instanceof DatabaseBudgetError) throw cause;
          const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
          if (
            Date.now() + 1 >= deadlineAtMs ||
            code === '57014' ||
            (cause instanceof Error && cause.message === 'Query read timeout')
          )
            throw new DatabaseBudgetError('statement', cause);
          throw cause;
        }
      };
    },
  });
}
