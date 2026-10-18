import { afterAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { pool, transaction, queryGroup } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import {
  credit,
  debit,
  expireCredits,
  reserve,
  settle,
  creditStateQueries,
  creditStateFromResults,
  prepareReservation,
  applyReservation,
  prepareSettlement,
  settlementQueries,
  finishSettlement,
} from '../../packages/core/src/ledger';

afterAll(async () => pool.end());
async function account(amount = 100n) {
  const org = id();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [org, 'Ledger boundary fixture']);
  if (amount) await transaction(org, (tx) => credit(tx, org, amount, `fixture:${id()}`));
  return org;
}
async function state(org: string) {
  return transaction(org, async (tx) => {
    const row = (
      await tx.query(
        'SELECT balance_micro_usd, reserved_micro_usd, credit_debt_micro_usd FROM organizations WHERE id=$1',
        [org],
      )
    ).rows[0];
    const lots = (await tx.query('SELECT COALESCE(sum(remaining_micro_usd),0) AS value FROM credit_lots'))
      .rows[0];
    expect(BigInt(lots.value) - BigInt(row.credit_debt_micro_usd)).toBe(BigInt(row.balance_micro_usd));
    expect(
      (await tx.query('SELECT journal_id FROM ledger GROUP BY journal_id HAVING sum(amount_micro_usd)<>0'))
        .rowCount,
    ).toBe(0);
    // Every journal must point at its immutable deduplication fact, not only sum to zero.
    expect(
      (
        await tx.query(
          'SELECT 1 FROM ledger l WHERE NOT EXISTS (SELECT 1 FROM financial_events f WHERE f.organization_id=l.organization_id AND f.reference=l.reference)',
        )
      ).rowCount,
    ).toBe(0);
    return {
      balance: BigInt(row.balance_micro_usd),
      reserved: BigInt(row.reserved_micro_usd),
      debt: BigInt(row.credit_debt_micro_usd),
    };
  });
}

describe('integer ledger boundaries against PostgreSQL', () => {
  it('allows a zero-funded reservation without creating financial facts or changing the wallet', async () => {
    const org = await account(0n);
    const accountPolicy = await transaction(org, (tx) => reserve(tx, org, 0n));
    expect(accountPolicy).toMatchObject({ balance_micro_usd: '0', reserved_micro_usd: '0' });
    expect(await state(org)).toEqual({ balance: 0n, reserved: 0n, debt: 0n });
    const facts = await transaction(org, (tx) =>
      tx.query(`SELECT (SELECT count(*)::integer FROM financial_events) AS events,
        (SELECT count(*)::integer FROM ledger) AS entries,
        (SELECT count(*)::integer FROM credit_lots) AS lots`),
    );
    expect(facts.rows[0]).toEqual({ events: 0, entries: 0, lots: 0 });
  });
  it('preserves explicit account execution limits while reserving the exact wallet amount', async () => {
    const org = await account();
    await transaction(org, (tx) =>
      tx.query('UPDATE organizations SET run_concurrency_limit=2,run_timeout_seconds=300 WHERE id=$1', [org]),
    );
    const accountPolicy = await transaction(org, (tx) => reserve(tx, org, 40n));
    expect(accountPolicy).toMatchObject({
      run_concurrency_limit: 2,
      run_timeout_seconds: 300,
      balance_micro_usd: '100',
      reserved_micro_usd: '40',
    });
    expect(await state(org)).toEqual({ balance: 100n, reserved: 40n, debt: 0n });
  });
  it('allows an exact balance reservation and rejects one additional micro-dollar', async () => {
    const org = await account();
    await transaction(org, (tx) => reserve(tx, org, 100n));
    await expect(transaction(org, (tx) => reserve(tx, org, 1n))).rejects.toMatchObject({
      code: 'insufficient_credit',
    });
    expect(await state(org)).toEqual({ balance: 100n, reserved: 100n, debt: 0n });
  });
  it.each(['billing_hold', 'payment_dispute_hold', 'reconciliation_hold'])(
    'blocks reservations during %s without changing funds',
    async (hold) => {
      const org = await account();
      await pool.query('UPDATE organizations SET settings=$2 WHERE id=$1', [org, { [hold]: true }]);
      await expect(transaction(org, (tx) => reserve(tx, org, 1n))).rejects.toMatchObject({
        status: 402,
        code: 'billing_hold',
      });
      expect(await state(org)).toEqual({ balance: 100n, reserved: 0n, debt: 0n });
    },
  );
  it.each([0n, -1n])('rejects credit %s without a financial event', async (amount) => {
    const org = await account(0n);
    await expect(transaction(org, (tx) => credit(tx, org, amount, 'invalid'))).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(
      (
        await transaction(org, (tx) =>
          tx.query('SELECT 1 FROM financial_events WHERE organization_id=$1', [org]),
        )
      ).rowCount,
    ).toBe(0);
  });
  it.each([-1n, 101n])(
    'rejects consumption %s outside the reservation, preserving the hold',
    async (amount) => {
      const org = await account();
      await transaction(org, (tx) => reserve(tx, org, 100n));
      await expect(transaction(org, (tx) => settle(tx, org, id(), 100n, amount))).rejects.toMatchObject({
        code: 'budget_exceeded',
      });
      expect(await state(org)).toEqual({ balance: 100n, reserved: 100n, debt: 0n });
    },
  );
  it.each([0n, 100n])(
    'settles boundary consumption %s and releases the entire reservation once',
    async (amount) => {
      const org = await account(),
        run = id();
      await transaction(org, (tx) => reserve(tx, org, 100n));
      await Promise.all(
        Array.from({ length: 8 }, () => transaction(org, (tx) => settle(tx, org, run, 100n, amount))),
      );
      expect(await state(org)).toEqual({ balance: 100n - amount, reserved: 0n, debt: 0n });
      expect(
        (
          await transaction(org, (tx) =>
            tx.query('SELECT 1 FROM financial_events WHERE organization_id=$1 AND reference=$2', [
              org,
              `run:${run}`,
            ]),
          )
        ).rowCount,
      ).toBe(1);
    },
  );
  it('deduplicates concurrent funding and reversal notifications independently', async () => {
    const org = await account(0n);
    const funding = await Promise.all(
      Array.from({ length: 8 }, () => transaction(org, (tx) => credit(tx, org, 100n, 'funding'))),
    );
    expect(funding.filter(Boolean)).toHaveLength(1);
    const refunds = await Promise.all(
      Array.from({ length: 8 }, () => transaction(org, (tx) => debit(tx, org, 40n, 'refund'))),
    );
    expect(refunds.filter(Boolean)).toHaveLength(1);
    expect(await state(org)).toEqual({ balance: 60n, reserved: 0n, debt: 0n });
  });
  it('preserves integers beyond JavaScript’s safe Number precision', async () => {
    const amount = 9007199254740993n,
      org = await account(amount);
    await transaction(org, (tx) => reserve(tx, org, amount));
    await transaction(org, (tx) => settle(tx, org, id(), amount, amount - 1n));
    expect(await state(org)).toEqual({ balance: 1n, reserved: 0n, debt: 0n });
  });
  it('rolls back an interrupted settlement so retry can settle it exactly once', async () => {
    const org = await account(),
      run = id();
    await transaction(org, (tx) => reserve(tx, org, 100n));
    await expect(
      transaction(org, async (tx) => {
        await settle(tx, org, run, 100n, 25n);
        throw new Error('fixture interruption');
      }),
    ).rejects.toThrow('fixture interruption');
    expect(await state(org)).toEqual({ balance: 100n, reserved: 100n, debt: 0n });
    await transaction(org, (tx) => settle(tx, org, run, 100n, 25n));
    expect(await state(org)).toEqual({ balance: 75n, reserved: 0n, debt: 0n });
  });
  it('records uncovered settlement as exact debt once when funding was reversed during the hold', async () => {
    const org = await account(),
      run = id();
    await transaction(org, (tx) => reserve(tx, org, 100n));
    await transaction(org, (tx) => debit(tx, org, 60n, 'reversed-funding'));
    expect(await state(org)).toEqual({ balance: 40n, reserved: 100n, debt: 0n });
    await expect(
      transaction(org, async (tx) => {
        await settle(tx, org, run, 100n, 80n);
        throw new Error('fixture interruption after debt allocation');
      }),
    ).rejects.toThrow('fixture interruption after debt allocation');
    expect(await state(org)).toEqual({ balance: 40n, reserved: 100n, debt: 0n });
    await transaction(org, (tx) => settle(tx, org, run, 100n, 80n));
    await transaction(org, (tx) => settle(tx, org, run, 100n, 80n));
    expect(await state(org)).toEqual({ balance: -40n, reserved: 0n, debt: 40n });
    await transaction(org, (tx) => credit(tx, org, 45n, 'replacement-funding'));
    expect(await state(org)).toEqual({ balance: 5n, reserved: 0n, debt: 0n });
  });
  it('retains a zero-wallet settlement identity without empty journals or wallet mutations', async () => {
    const org = await account(0n),
      run = id();
    await Promise.all(
      Array.from({ length: 8 }, () => transaction(org, (tx) => settle(tx, org, run, 0n, 0n))),
    );
    expect(await state(org)).toEqual({ balance: 0n, reserved: 0n, debt: 0n });
    const facts = await transaction(org, (tx) =>
      tx.query(
        `SELECT (SELECT count(*)::int FROM financial_events WHERE reference=$1) AS events,
       (SELECT count(*)::int FROM ledger WHERE reference=$1) AS entries`,
        [`run:${run}`],
      ),
    );
    expect(facts.rows[0]).toEqual({ events: 1, entries: 0 });
  });
  it('expires credit exactly at its deadline and makes repeated expiry a no-op', async () => {
    const org = await account(0n),
      deadline = new Date('2040-01-01T00:00:00Z');
    await transaction(org, (tx) => credit(tx, org, 100n, 'expiring', 'included_credits', deadline));
    expect(await transaction(org, (tx) => expireCredits(tx, org, new Date(deadline.getTime() - 1)))).toBe(0n);
    expect(await transaction(org, (tx) => expireCredits(tx, org, deadline))).toBe(100n);
    expect(await transaction(org, (tx) => expireCredits(tx, org, deadline))).toBe(0n);
    expect(await state(org)).toEqual({ balance: 0n, reserved: 0n, debt: 0n });
  });
});

it('settles a thousand open credit lots without one database round trip per lot', async () => {
  const org = await account(1000n),
    run = id();
  await transaction(org, async (tx) => {
    await tx.query('DELETE FROM credit_lots WHERE organization_id=$1', [org]);
    await tx.query(
      `INSERT INTO credit_lots(id,organization_id,reference,kind,original_micro_usd,remaining_micro_usd,expires_at)
      SELECT gen_random_uuid(),$1,'lot-'||value,'purchased_credits',1,1,'2040-01-01'::timestamptz+value*interval '1 second'
      FROM generate_series(1,1000) AS value`,
      [org],
    );
    await reserve(tx, org, 1000n);
  });
  const queries = vi.spyOn(pg.Client.prototype, 'query');
  const started = performance.now();
  let statements = 0;
  try {
    await transaction(org, (tx) => settle(tx, org, run, 1000n, 150n));
    statements = queries.mock.calls.length;
    // A coarse operation-level budget allows query-plan improvements while
    // catching the former per-lot UPDATE pattern, which would exceed150 calls.
    expect(statements).toBeLessThan(50);
  } finally {
    queries.mockRestore();
  }
  const elapsed = performance.now() - started;
  expect(await state(org)).toEqual({ balance: 850n, reserved: 0n, debt: 0n });
  const lots = await transaction(org, (tx) =>
    tx.query(
      `SELECT count(*) FILTER (WHERE remaining_micro_usd=0)::int AS spent,
     count(*) FILTER (WHERE remaining_micro_usd=1)::int AS remaining FROM credit_lots WHERE organization_id=$1`,
      [org],
    ),
  );
  expect(lots.rows[0]).toEqual({ spent: 150, remaining: 850 });
  console.log(
    JSON.stringify({
      experiment: 'ledger-settlement',
      open_lots: 1000,
      statements,
      elapsed_ms: Math.round(elapsed * 100) / 100,
    }),
  );
});

describe('reservation serialization and protected expiring funds', () => {
  it('protects reservations added between composed settlement phases when credit expires', async () => {
    const org = await account(100n);
    await transaction(org, async (tx) => {
      await credit(tx, org, 100n, 'expiring', 'included_credits', new Date('2040-01-01T00:00:00Z'));
      await reserve(tx, org, 80n);
      const settlement = prepareSettlement(tx, org, 'first-release', 80n, 0n);
      const observations = await queryGroup(tx, settlementQueries(tx, settlement));
      await reserve(tx, org, 120n);
      // Cross the expiry boundary deterministically after the account read and
      // new reservation, without depending on wall-clock scheduling in CI.
      await tx.query(
        "UPDATE credit_lots SET expires_at=clock_timestamp()-interval '1 second' WHERE reference='expiring'",
      );
      await finishSettlement(tx, settlement, observations);
    });
    expect(await state(org)).toEqual({ balance: 200n, reserved: 120n, debt: 0n });
    await transaction(org, (tx) => settle(tx, org, id(), 120n, 0n));
    expect(await state(org)).toEqual({ balance: 100n, reserved: 0n, debt: 0n });
  });
  it('serializes contenders at the actual organization lock and prevents overspending', async () => {
    const org = await account(100n);
    let release!: () => void;
    let locked!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const owner = transaction(org, async (tx) => {
      await tx.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [org]);
      locked();
      await barrier;
      await reserve(tx, org, 60n);
    });
    await acquired;
    const competing = transaction(org, (tx) => reserve(tx, org, 60n));
    // pg_stat_activity establishes that the contender is blocked, not merely started concurrently.
    try {
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                `SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%organizations%'`,
              )
            ).rows[0].n,
        )
        .toBeGreaterThan(0);
    } finally {
      release();
    }
    await owner;
    await expect(competing).rejects.toMatchObject({ code: 'insufficient_credit' });
    expect(await state(org)).toEqual({ balance: 100n, reserved: 60n, debt: 0n });
  });
  it('evaluates expiry after an ordered account-lock wait rather than when the reservation was submitted', async () => {
    const org = await account(100n);
    let release = () => {};
    let acquired = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const owner = transaction(org, async (tx) => {
      await tx.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [org]);
      acquired();
      await gate;
      await tx.query(
        "UPDATE credit_lots SET expires_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1",
        [org],
      );
    });
    await ready;
    const contender = transaction(org, (tx) => reserve(tx, org, 100n));
    const rejected = expect(contender).rejects.toMatchObject({ code: 'insufficient_credit' });
    try {
      await expect
        .poll(
          async () =>
            (
              await pool.query(
                `SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%organizations%'`,
              )
            ).rows[0].n,
        )
        .toBeGreaterThan(0);
    } finally {
      release();
    }
    await owner;
    await rejected;
    expect((await state(org)).reserved).toBe(0n);
  });
  it('protects only reserved expiry credit and releases the unused portion after settlement', async () => {
    const org = await account(0n),
      deadline = new Date('2040-01-01T00:00:00Z');
    await transaction(org, (tx) => credit(tx, org, 100n, 'expiring-lot', 'included_credits', deadline));
    await transaction(org, (tx) => reserve(tx, org, 60n));
    expect(await transaction(org, (tx) => expireCredits(tx, org, deadline))).toBe(40n);
    expect(await state(org)).toEqual({ balance: 60n, reserved: 60n, debt: 0n });
    expect(await transaction(org, (tx) => expireCredits(tx, org, deadline))).toBe(0n);
    await transaction(org, (tx) => settle(tx, org, id(), 60n, 25n));
    expect(await transaction(org, (tx) => expireCredits(tx, org, deadline))).toBe(35n);
    expect(await state(org)).toEqual({ balance: 0n, reserved: 0n, debt: 0n });
  });
  it('repays debt across partial and excess funding without resurrecting refunded lots', async () => {
    const org = await account(0n);
    await transaction(org, (tx) => debit(tx, org, 80n, 'reversal-before-funding'));
    expect(await state(org)).toEqual({ balance: -80n, reserved: 0n, debt: 80n });
    await transaction(org, (tx) => credit(tx, org, 30n, 'partial-repayment'));
    expect(await state(org)).toEqual({ balance: -50n, reserved: 0n, debt: 50n });
    await transaction(org, (tx) => credit(tx, org, 70n, 'excess-repayment'));
    expect(await state(org)).toEqual({ balance: 20n, reserved: 0n, debt: 0n });
  });
  it.each([-1n, 0n])('handles debit boundary %s without losing financial identity', async (amount) => {
    const org = await account();
    if (amount < 0n)
      await expect(transaction(org, (tx) => debit(tx, org, amount, 'invalid-debit'))).rejects.toMatchObject({
        code: 'invalid_amount',
      });
    else {
      expect(await transaction(org, (tx) => debit(tx, org, amount, 'zero-debit'))).toBe(true);
      expect(await transaction(org, (tx) => debit(tx, org, amount, 'zero-debit'))).toBe(false);
    }
    expect(await state(org)).toEqual({ balance: 100n, reserved: 0n, debt: 0n });
  });
});

it('allocates an expiring reservation across multiple lots and makes repeated expiry journal-free', async () => {
  const org = await account(0n),
    deadline = new Date('2040-01-01T00:00:00Z');
  await transaction(org, async (tx) => {
    await credit(tx, org, 80n, 'first-expiry', 'included_credits', new Date(deadline.getTime() - 1));
    await credit(tx, org, 80n, 'second-expiry', 'included_credits', deadline);
    await reserve(tx, org, 100n);
  });
  expect(await transaction(org, (tx) => expireCredits(tx, org, deadline))).toBe(60n);
  const lots = await transaction(org, (tx) =>
    tx.query('SELECT reference,remaining_micro_usd FROM credit_lots ORDER BY expires_at'),
  );
  expect(lots.rows).toEqual([
    { reference: 'first-expiry', remaining_micro_usd: '80' },
    { reference: 'second-expiry', remaining_micro_usd: '20' },
  ]);
  const journals = () =>
    transaction(org, (tx) => tx.query('SELECT reference,account,amount_micro_usd FROM ledger ORDER BY id'));
  const before = (await journals()).rows;
  expect(await transaction(org, (tx) => expireCredits(tx, org, deadline))).toBe(0n);
  expect((await journals()).rows).toEqual(before);
  expect(await state(org)).toEqual({ balance: 100n, reserved: 100n, debt: 0n });
});

it('consumes multiple lots and preserves the financial account and event references', async () => {
  const org = await account(0n),
    run = id();
  await transaction(org, async (tx) => {
    await credit(tx, org, 30n, 'first-funding');
    await credit(tx, org, 80n, 'second-funding');
    await reserve(tx, org, 60n);
    await settle(tx, org, run, 60n, 60n);
    await debit(tx, org, 10n, 'refund-after-usage');
  });
  expect(await state(org)).toEqual({ balance: 40n, reserved: 0n, debt: 0n });
  const journal = await transaction(org, (tx) =>
    tx.query('SELECT reference,account,amount_micro_usd FROM ledger ORDER BY reference,account'),
  );
  const rows = journal.rows;
  expect(rows.filter((r) => r.reference === 'first-funding')).toEqual([
    { reference: 'first-funding', account: 'funding', amount_micro_usd: '-30' },
    { reference: 'first-funding', account: 'purchased_credits', amount_micro_usd: '30' },
  ]);
  expect(rows.filter((r) => r.reference === `run:${run}`)).toEqual([
    { reference: `run:${run}`, account: 'available_credits', amount_micro_usd: '-60' },
    { reference: `run:${run}`, account: 'consumption', amount_micro_usd: '60' },
  ]);
  expect(rows.filter((r) => r.reference === 'refund-after-usage')).toEqual([
    { reference: 'refund-after-usage', account: 'available_credits', amount_micro_usd: '-10' },
    { reference: 'refund-after-usage', account: 'refunds', amount_micro_usd: '10' },
  ]);
});

describe('transaction-owned composed financial plans', () => {
  it.each([
    { fault: 'missing row', rows: [] },
    { fault: 'malformed reservation', rows: [{ reserved_micro_usd: 0 }] },
  ])('rolls back settlement when its wallet result has a $fault', async ({ rows }) => {
    const org = await account(100n),
      run = id(),
      reference = `run:${run}`;
    await transaction(org, (tx) => reserve(tx, org, 80n));
    let injected = false;
    await expect(
      transaction(org, async (tx) => {
        const plan = prepareSettlement(tx, org, reference, 80n, 30n);
        const observations = await queryGroup(tx, settlementQueries(tx, plan));
        // This fixture exercises only pg's Promise form; narrowing the local
        // view avoids its callback overload determining the spy's types.
        const promiseTx: {
          query(statement: string | pg.QueryConfig, values?: unknown[]): Promise<pg.QueryResult>;
        } = tx;
        const original = promiseTx.query;
        const query = vi.spyOn(promiseTx, 'query').mockImplementation((...args) => {
          const pending = original.apply(tx, args);
          const statement = args[0];
          const text = typeof statement === 'string' ? statement : statement.text;
          if (text.includes('RETURNING reserved_micro_usd'))
            return pending.then((result: pg.QueryResult) => {
              injected = true;
              // Execute the real mutation first: rejecting its invalid result
              // must roll back the wallet, lot debit, journal and event identity.
              return { ...result, rows, rowCount: rows.length };
            });
          return pending;
        });
        try {
          await finishSettlement(tx, plan, observations);
        } finally {
          query.mockRestore();
        }
      }),
    ).rejects.toMatchObject({ code: 'billing_unavailable' });
    expect(injected).toBe(true);
    expect(await state(org)).toEqual({ balance: 100n, reserved: 80n, debt: 0n });
    const facts = await transaction(org, (tx) =>
      tx.query(
        `SELECT (SELECT count(*)::integer FROM financial_events WHERE reference=$1) AS events,
         (SELECT count(*)::integer FROM ledger WHERE reference=$1) AS entries`,
        [reference],
      ),
    );
    expect(facts.rows[0]).toEqual({ events: 0, entries: 0 });
    await transaction(org, (tx) => settle(tx, org, run, 80n, 30n));
    expect(await state(org)).toEqual({ balance: 70n, reserved: 0n, debt: 0n });
  });
  it('rejects reservation reuse and cross-transaction reuse without applying a second hold', async () => {
    const org = await account(100n);
    const prepared = await transaction(org, async (tx) => {
      const plan = prepareReservation(
        creditStateFromResults(tx, org, await queryGroup(tx, creditStateQueries(org))),
        40n,
      );
      await applyReservation(tx, plan);
      await expect(applyReservation(tx, plan)).rejects.toMatchObject({ code: 'billing_state_stale' });
      return plan;
    });
    await expect(transaction(org, (tx) => applyReservation(tx, prepared))).rejects.toMatchObject({
      code: 'billing_state_stale',
    });
    expect(await state(org)).toEqual({ balance: 100n, reserved: 40n, debt: 0n });
  });
  it('rejects a prepared balance changed inside the same transaction and rolls back the entire mutation', async () => {
    const org = await account(100n);
    await expect(
      transaction(org, async (tx) => {
        const plan = prepareReservation(
          creditStateFromResults(tx, org, await queryGroup(tx, creditStateQueries(org))),
          60n,
        );
        await reserve(tx, org, 60n);
        await applyReservation(tx, plan);
      }),
    ).rejects.toMatchObject({ code: 'billing_state_stale' });
    expect(await state(org)).toEqual({ balance: 100n, reserved: 0n, debt: 0n });
  });
  it('allows each composed settlement result to release its hold only once', async () => {
    const org = await account(100n),
      run = id();
    await transaction(org, (tx) => reserve(tx, org, 80n));
    await transaction(org, async (tx) => {
      const plan = prepareSettlement(tx, org, `run:${run}`, 80n, 30n);
      const results = await queryGroup(tx, settlementQueries(tx, plan));
      await finishSettlement(tx, plan, results);
      await expect(finishSettlement(tx, plan, results)).rejects.toMatchObject({
        code: 'billing_state_stale',
      });
    });
    expect(await state(org)).toEqual({ balance: 70n, reserved: 0n, debt: 0n });
  });
});
