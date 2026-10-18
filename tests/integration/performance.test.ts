import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../packages/core/src/config';
import pg from 'pg';
import {
  pool,
  authPool,
  credentialPool,
  queryGroup,
  transaction,
  transactionIdentity,
} from '../../packages/db';
import { TransactionCommitUnknownError } from '../../packages/db';
import { observeDatabasePools } from '../../packages/db/diagnostics';
import { createPerformanceCollector } from '../../packages/core/src/performance';
import type { PerformanceRecord } from '../../packages/contracts/performance';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function profile() {
  const records: PerformanceRecord[] = [];
  const collector = createPerformanceCollector({
    sampleRate: 1,
    durationSeconds: 300,
    sink: {
      enqueue: (record) => {
        if (record.state !== 'started') records.push(record);
      },
      flush: async () => {},
      close: async () => {},
    },
  });
  const detach = observeDatabasePools(
    [
      [pool, 'domain'],
      [authPool, 'identity'],
      [credentialPool, 'credential'],
    ],
    () => collector.ticket(),
  );
  collector.onClose(detach);
  cleanup.push(() => collector.close());
  return { collector, records };
}
describe('owned database profiling', () => {
  it('counts statements separately from ordered groups and confirms transaction outcomes', async () => {
    const { collector, records } = profile();
    const result = await collector.run(
      'rest',
      {},
      () =>
        transaction(
          null,
          async (tx) => {
            await queryGroup(tx, [{ text: 'SELECT 1' }, { text: 'SELECT 2' }]);
            return (await tx.query<{ value: number }>('SELECT 3::integer AS value')).rows[0].value;
          },
          { deadlineAtMs: Date.now() + 5000 },
        ),
      'foreground',
      false,
    );
    expect(result).toBe(3);
    expect(records[0].counters).toMatchObject({ statements: 6, groups: 4, transactions: 1, commits: 1 });
    expect(records[0].stages['db.commit']?.count).toBe(1);
  });
  it('preserves Promise and callback forms on the same real client', async () => {
    const queryPrototype = pg.Client.prototype.query;
    const connectPrototype = pg.Pool.prototype.connect;
    const { collector, records } = profile();
    await collector.run(
      'model',
      {},
      async () => {
        const client = await pool.connect();
        try {
          expect((await client.query<{ value: number }>('SELECT 5::integer AS value')).rows[0].value).toBe(5);
          const value = await new Promise<number>((resolve, reject) => {
            client.query<{ value: number }>('SELECT $1::integer AS value', [6], (error, result) =>
              error ? reject(error) : resolve(result.rows[0].value),
            );
          });
          expect(value).toBe(6);
        } finally {
          client.release();
        }
        await new Promise<void>((resolve, reject) =>
          pool.connect((error, client, release) => {
            if (error || !client) {
              reject(error ?? new Error('Missing client'));
              return;
            }
            client.query('SELECT 7', (queryError) => {
              release();
              queryError ? reject(queryError) : resolve();
            });
          }),
        );
      },
      'foreground',
      false,
    );
    expect(records[0].counters.statements).toBe(3);
    expect(pg.Client.prototype.query).toBe(queryPrototype);
    expect(pg.Pool.prototype.connect).toBe(connectPrototype);
    await collector.close();
  });
  it('preserves Query object identity and events without claiming statement measurements', async () => {
    const { collector, records } = profile();
    const rows: number[] = [];
    await collector.run(
      'rest',
      {},
      async () => {
        const client = await pool.connect();
        try {
          const query = new pg.Query<{ value: number }>('SELECT 17::integer AS value');
          const completed = new Promise<void>((resolve, reject) => {
            query.on('row', (row) => rows.push(row.value));
            query.once('error', reject);
            query.once('end', () => resolve());
          });
          expect(client.query(query)).toBe(query);
          await completed;
        } finally {
          client.release();
        }
      },
      'foreground',
      false,
    );
    expect(rows).toEqual([17]);
    expect(records[0].counters).toMatchObject({ unsupported_driver_form: 1, checkouts: 1 });
    expect(records[0].counters.statements).toBeUndefined();
    expect(records[0].stages['db.query']).toBeUndefined();
  });
  it('measures Pool.query once through its checkout and client query', async () => {
    const { collector, records } = profile();
    const result = await collector.run(
      'rest',
      {},
      () => pool.query<{ value: number }>('SELECT 19::integer AS value'),
      'foreground',
      false,
    );
    expect(result.rows[0].value).toBe(19);
    expect(records[0].counters).toMatchObject({ statements: 1, checkouts: 1 });
    expect(records[0].stages['db.query']?.count).toBe(1);
    expect(records[0].stages['db.checkout']?.count).toBe(1);
  });
  it('preserves newer instance wrappers on detach and reports the conflict once', async () => {
    const owned = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
    cleanup.push(() => owned.end());
    const originalConnect = owned.connect;
    const collector = createPerformanceCollector({
      sampleRate: 1,
      durationSeconds: 300,
      sink: { enqueue: () => {}, flush: async () => {}, close: async () => {} },
    });
    const detach = observeDatabasePools([[owned, 'domain']], () => collector.ticket());
    collector.onClose(detach);
    cleanup.push(() => collector.close());
    const client = await owned.connect();
    const observedConnect = owned.connect,
      observedQuery = client.query;
    const newerConnect = function (this: pg.Pool, ...args: unknown[]): unknown {
      return Reflect.apply(observedConnect, this, args);
    } as pg.Pool['connect'];
    const newerQuery = function (this: pg.PoolClient, ...args: unknown[]): unknown {
      return Reflect.apply(observedQuery, this, args);
    } as pg.PoolClient['query'];
    owned.connect = newerConnect;
    client.query = newerQuery;
    let released = false;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await collector.close();
      detach();
      expect(owned.connect).toBe(newerConnect);
      expect(client.query).toBe(newerQuery);
      expect((await client.query<{ value: number }>('SELECT 23::integer AS value')).rows[0].value).toBe(23);
      client.release();
      released = true;
      expect((await owned.query<{ value: number }>('SELECT 29::integer AS value')).rows[0].value).toBe(29);
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({ code: 'performance_profile_detach_conflict' }),
      );
    } finally {
      warning.mockRestore();
      owned.connect = originalConnect;
      // The collector no longer owns the retained wrapper; pool teardown ends its client.
      if (!released) client.release();
    }
  });
  it('captures parallel completion against the submitting request, not the driver callback context', async () => {
    const { collector, records } = profile();
    let submitted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      submitted = resolve;
    });
    const first = collector.run(
      'rest',
      {},
      () =>
        transaction(null, async (tx) => {
          const pending = tx.query('SELECT pg_sleep(0.02)');
          submitted();
          await pending;
        }),
      'foreground',
      false,
    );
    await started;
    await collector.run(
      'mcp',
      {},
      () =>
        transaction(null, async (tx) => {
          await queryGroup(tx, [{ text: 'SELECT 1' }, { text: 'SELECT 2' }, { text: 'SELECT 3' }]);
        }),
      'foreground',
      false,
    );
    await first;
    expect(records.find((record) => record.operation === 'rest')?.counters.statements).toBe(4);
    expect(records.find((record) => record.operation === 'mcp')?.counters.statements).toBe(6);
  });
  it('records rollback without changing rejection and does not serialize secret parameters', async () => {
    const { collector, records } = profile();
    await expect(
      collector.run(
        'tool',
        {},
        () =>
          transaction(null, async (tx) => {
            await tx.query('SELECT $1::jsonb', [{ secret: 'DO_NOT_EXPORT_THIS' }]);
            throw new Error('business error');
          }),
        'foreground',
        false,
      ),
    ).rejects.toThrow('business error');
    expect(records[0].counters.rollbacks).toBe(1);
    expect(records[0].counters.unknown_parameters).toBe(1);
    expect(JSON.stringify(records)).not.toContain('DO_NOT_EXPORT_THIS');
  });
  it('expires collection while a query completes and restores owned methods', async () => {
    const original = pool.connect;
    const { collector, records } = profile();
    let proceed: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const pending = collector.run(
      'run',
      {},
      () =>
        transaction(null, async (tx) => {
          await barrier;
          return (await tx.query<{ value: number }>('SELECT 9::integer AS value')).rows[0].value;
        }),
      'job',
      false,
    );
    await collector.close();
    proceed();
    expect(await pending).toBe(9);
    expect(pool.connect).toBe(original);
    expect(records.filter((record) => record.type === 'operation')).toHaveLength(1);
  });
  it('does not instrument a client whose queued checkout resolves after collection closes', async () => {
    const owned = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
    cleanup.push(() => owned.end());
    const held = await owned.connect();
    const originalConnect = owned.connect,
      originalQuery = held.query;
    const records: PerformanceRecord[] = [];
    const collector = createPerformanceCollector({
      sampleRate: 1,
      durationSeconds: 300,
      sink: { enqueue: (record) => records.push(record), flush: async () => {}, close: async () => {} },
    });
    const detach = observeDatabasePools([[owned, 'domain']], () => collector.ticket());
    collector.onClose(detach);
    cleanup.push(() => collector.close());
    let released = false;
    const pending = collector.run(
      'rest',
      {},
      async () => {
        const client = await owned.connect();
        try {
          expect(client).toBe(held);
          expect(client.query).toBe(originalQuery);
          return (await client.query<{ value: number }>('SELECT 11::integer AS value')).rows[0].value;
        } finally {
          client.release();
        }
      },
      'foreground',
      false,
    );
    try {
      expect(owned.waitingCount).toBe(1);
      await collector.close();
      expect(owned.connect).toBe(originalConnect);
      const completedRecords = records.length;
      held.release();
      released = true;
      expect(await pending).toBe(11);
      expect(held.query).toBe(originalQuery);
      expect(owned.connect).toBe(originalConnect);
      expect(records).toHaveLength(completedRecords);
      expect(owned.idleCount).toBe(1);
    } finally {
      if (!released) held.release();
      await pending.catch(() => {});
    }
  });
  it('records a confirmed budget rollback without claiming a commit', async () => {
    const { collector, records } = profile();
    await expect(
      collector.run(
        'rest',
        {},
        () =>
          transaction(null, (tx) => tx.query('SELECT pg_sleep(1)'), {
            statementTimeoutMs: 10,
            deadlineAtMs: Date.now() + 5000,
          }),
        'foreground',
        false,
      ),
    ).rejects.toMatchObject({ phase: 'statement', rollbackConfirmed: true });
    expect(records[0].counters).toMatchObject({ transactions: 1, rollbacks: 1 });
    expect(records[0].counters.commits).toBeUndefined();
    expect(records[0].transactions).toMatchObject([{ outcome: 'rolled_back' }]);
  });
  it('reports an unknown COMMIT acknowledgment independently from query timing', async () => {
    const { collector, records } = profile();
    let restore = () => {};
    try {
      const pending = collector.run(
        'rest',
        {},
        () =>
          transaction(null, async (tx) => {
            await tx.query('SELECT 1');
            const query = vi
              .spyOn(tx, 'query')
              .mockRejectedValueOnce(new Error('Synthetic lost commit acknowledgment'));
            restore = () => query.mockRestore();
          }),
        'foreground',
        false,
      );
      await expect(pending).rejects.toBeInstanceOf(TransactionCommitUnknownError);
      expect(records[0].counters).toMatchObject({ transactions: 1, commit_unknown: 1 });
      expect(records[0].counters.commits).toBeUndefined();
      expect(records[0].counters.rollbacks).toBeUndefined();
      expect(records[0].transactions).toMatchObject([{ outcome: 'commit_unknown' }]);
    } finally {
      restore();
    }
  });
  it('does not accept a saved transaction identity after commit', async () => {
    let saved: pg.PoolClient | undefined;
    const first = await transaction(null, async (tx) => {
      saved = tx;
      return transactionIdentity(tx);
    });
    expect(saved).toBeDefined();
    if (saved) {
      const closed = saved;
      expect(() => transactionIdentity(closed)).toThrow('active managed transaction');
    }
    const second = await transaction(null, async (tx) => transactionIdentity(tx));
    expect(second).not.toBe(first);
  });
});
