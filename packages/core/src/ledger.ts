import { queryGroup, transactionIdentity, type Tx } from '../../db';
import type { QueryConfig, QueryResult } from 'pg';
import { id } from './crypto';
import { assert } from './errors';
/** Financial facts are immutable balanced journals; the balance is a transactional projection.
 * NO KEY UPDATE serializes balances without conflicting with foreign-key KEY SHARE
 * locks held by concurrent file/checkpoint/event inserts for the same organization. */
export async function credit(
  tx: Tx,
  org: string,
  amount: bigint,
  reference: string,
  account = 'purchased_credits',
  expiresAt?: Date,
) {
  assert(amount > 0n, 400, 'invalid_request', 'Credit amount must be positive.');
  const organization = (
    await tx.query('SELECT credit_debt_micro_usd FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [org])
  ).rows[0];
  const seen = await tx.query(
    'INSERT INTO financial_events(organization_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING reference',
    [org, reference],
  );
  if (!seen.rowCount) return false;
  const debt = BigInt(organization.credit_debt_micro_usd),
    repaid = debt < amount ? debt : amount;
  await tx.query(
    'INSERT INTO credit_lots(id,organization_id,reference,kind,original_micro_usd,remaining_micro_usd,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id(), org, reference, account, amount.toString(), (amount - repaid).toString(), expiresAt || null],
  );
  await tx.query(
    'UPDATE organizations SET credit_debt_micro_usd=credit_debt_micro_usd-$2::bigint WHERE id=$1',
    [org, repaid.toString()],
  );
  const journal = id();
  await tx.query(
    'INSERT INTO ledger(id,organization_id,journal_id,account,amount_micro_usd,reference) VALUES($1,$2,$3,$4,$5,$6),($7,$2,$3,$8,$9,$6)',
    [id(), org, journal, account, amount.toString(), reference, id(), 'funding', (-amount).toString()],
  );
  await tx.query('UPDATE organizations SET balance_micro_usd=balance_micro_usd+$2::bigint WHERE id=$1', [
    org,
    amount.toString(),
  ]);
  return true;
}
/** Ordinary native/tool/Host callers use exactly the same financial owner as
 * composed admission. No new organization advisory lock is acquired here. */
export async function reserve(tx: Tx, org: string, amount: bigint) {
  const state = creditStateFromResults(tx, org, await queryGroup(tx, creditStateQueries(org)));
  return applyReservation(tx, prepareReservation(state, amount));
}

type CreditState = { account: LockedAccount; lots: readonly ExpiredCreditLot[] };
export type LockedCreditState = Readonly<{ account: LockedAccount }>;
export type PreparedReservation = Readonly<{ account: LockedAccount }>;
const creditStates = new WeakMap<
  LockedCreditState,
  {
    tx: Tx;
    transaction: object;
    org: string;
    lots: readonly ExpiredCreditLot[];
    consumed: boolean;
  }
>();
const reservations = new WeakMap<
  PreparedReservation,
  {
    tx: Tx;
    transaction: object;
    org: string;
    before: LockedAccount;
    changes: ReturnType<typeof expirationChanges>;
    amount: bigint;
    consumed: boolean;
  }
>();

export function creditStateQueries(org: string, at?: Date): QueryConfig[] {
  return [accountLock(org), expiredLots(org, at)];
}
export function creditStateFromResults(
  tx: Tx,
  org: string,
  results: readonly QueryResult<Record<string, unknown>>[],
): LockedCreditState {
  const { account, lots } = decodeCreditState(results);
  const state = { account };
  creditStates.set(state, { tx, transaction: transactionIdentity(tx), org, lots, consumed: false });
  return state;
}
export function prepareReservation(state: LockedCreditState, amount: bigint): PreparedReservation {
  const current = creditStates.get(state);
  assert(
    current && !current.consumed && current.transaction === transactionIdentity(current.tx),
    500,
    'billing_state_stale',
    'Reload the current billing account before reserving funds.',
  );
  current.consumed = true;
  assert(amount >= 0n, 400, 'invalid_amount', 'Reservation must be nonnegative.');
  const row = state.account;
  const changes = expirationChanges(row.reserved_micro_usd, current.lots);
  assert(
    !row.settings.billing_hold && !row.settings.payment_dispute_hold && !row.settings.reconciliation_hold,
    402,
    'billing_hold',
    'Resolve the payment issue in Billing before starting new work.',
  );
  assert(
    BigInt(row.balance_micro_usd) - changes.total - BigInt(row.reserved_micro_usd) >= amount,
    402,
    'insufficient_credit',
    'Add credits or reduce the maximum run budget.',
  );
  const prepared = {
    account: {
      ...row,
      balance_micro_usd: (BigInt(row.balance_micro_usd) - changes.total).toString(),
      reserved_micro_usd: (BigInt(row.reserved_micro_usd) + amount).toString(),
    },
  };
  reservations.set(prepared, { ...current, before: row, changes, amount, consumed: false });
  return prepared;
}
/** Claim before submission: a plan cannot be applied twice, after another
 * wallet mutation, or after a pooled client has entered a new transaction. */
export function reservationQuery(tx: Tx, prepared: PreparedReservation): QueryConfig | undefined {
  const current = reservations.get(prepared);
  assert(
    current && current.tx === tx && current.transaction === transactionIdentity(tx) && !current.consumed,
    500,
    'billing_state_stale',
    'Reload the current billing account before reserving funds.',
  );
  current.consumed = true;
  if (!current.amount && !current.changes.total) return undefined;
  return {
    text: `WITH valid AS MATERIALIZED (
      SELECT id FROM organizations WHERE id=$1 AND balance_micro_usd=$4::bigint AND reserved_micro_usd=$5::bigint
        AND settings=$6::jsonb AND plan=$7 AND run_concurrency_limit IS NOT DISTINCT FROM $8::integer
        AND run_timeout_seconds IS NOT DISTINCT FROM $9::integer
    ), changed AS MATERIALIZED (
      SELECT entry.* FROM jsonb_to_recordset($2::jsonb) AS entry(
        id uuid,remaining bigint,previous bigint,journal uuid,reference text,amount bigint,debit bigint,"creditId" uuid,"debitId" uuid)
      WHERE EXISTS(SELECT 1 FROM valid)
    ), events AS (
      INSERT INTO financial_events(organization_id,reference) SELECT $1,reference FROM changed RETURNING reference
    ), journals AS (
      INSERT INTO ledger(id,organization_id,journal_id,account,amount_micro_usd,reference)
      SELECT entry.id,$1,changed.journal,entry.account,entry.amount,changed.reference
      FROM changed JOIN events USING(reference)
      CROSS JOIN LATERAL (VALUES (changed."creditId",'expired_credits',changed.amount),(changed."debitId",'available_credits',changed.debit)) AS entry(id,account,amount)
    ), lots AS (
      UPDATE credit_lots AS lot SET remaining_micro_usd=changed.remaining FROM changed
      WHERE lot.organization_id=$1 AND lot.id=changed.id AND lot.remaining_micro_usd=changed.previous RETURNING lot.id
    ), wallet AS (
      UPDATE organizations SET balance_micro_usd=balance_micro_usd-$3::bigint,reserved_micro_usd=reserved_micro_usd+$10::bigint
      WHERE id IN(SELECT id FROM valid) RETURNING id
    ) SELECT (SELECT count(*) FROM wallet)::integer AS accounts,(SELECT count(*) FROM lots)::integer AS lots`,
    values: [
      current.org,
      JSON.stringify(current.changes.entries),
      current.changes.total.toString(),
      current.before.balance_micro_usd,
      current.before.reserved_micro_usd,
      JSON.stringify(current.before.settings),
      current.before.plan,
      current.before.run_concurrency_limit,
      current.before.run_timeout_seconds,
      current.amount.toString(),
    ],
  };
}
export function checkReservationResult(
  prepared: PreparedReservation,
  result?: QueryResult<Record<string, unknown>>,
) {
  const current = reservations.get(prepared),
    row = result?.rows[0];
  assert(
    current?.consumed &&
      ((!current.amount && !current.changes.total && !result) ||
        (row?.accounts === 1 && row.lots === current.changes.entries.length)),
    500,
    'billing_state_stale',
    'The billing account changed during reservation.',
  );
  return prepared.account;
}
export async function applyReservation(tx: Tx, prepared: PreparedReservation) {
  const query = reservationQuery(tx, prepared);
  return checkReservationResult(prepared, query ? await tx.query(query) : undefined);
}

export async function settle(tx: Tx, org: string, runId: string, reserved: bigint, consumed: bigint) {
  return settleReservation(tx, org, `run:${runId}`, reserved, consumed);
}
/** Settle a separately authorized compute allocation without inventing an agent run. */
export async function settleReservation(
  tx: Tx,
  org: string,
  reference: string,
  reserved: bigint,
  consumed: bigint,
) {
  const plan = prepareSettlement(tx, org, reference, reserved, consumed);
  await finishSettlement(tx, plan, await queryGroup(tx, settlementQueries(tx, plan)));
}
const preparedSettlement = Symbol('preparedSettlement');
export type PreparedSettlement = { readonly [preparedSettlement]: true };
const settlementPlans = new WeakMap<
  PreparedSettlement,
  {
    tx: Tx;
    transaction: object;
    org: string;
    reference: string;
    reserved: bigint;
    consumed: bigint;
    submitted: boolean;
    finished: boolean;
  }
>();
export function prepareSettlement(
  tx: Tx,
  org: string,
  reference: string,
  reserved: bigint,
  consumed: bigint,
): PreparedSettlement {
  assert(
    consumed >= 0n && consumed <= reserved,
    409,
    'budget_exceeded',
    'Usage exceeds the authorized reservation.',
  );
  const plan: PreparedSettlement = { [preparedSettlement]: true };
  settlementPlans.set(plan, {
    tx,
    transaction: transactionIdentity(tx),
    org,
    reference,
    reserved,
    consumed,
    submitted: false,
    finished: false,
  });
  return plan;
}
export function settlementQueries(tx: Tx, plan: PreparedSettlement): QueryConfig[] {
  const state = settlementPlans.get(plan);
  assert(
    state && state.tx === tx && state.transaction === transactionIdentity(tx) && !state.submitted,
    500,
    'billing_state_stale',
    'Reload the current billing account before settlement.',
  );
  state.submitted = true;
  const identity = {
    text: 'INSERT INTO financial_events(organization_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING reference',
    values: [state.org, state.reference],
  };
  // A zero/zero settlement still retains its business identity, with no wallet
  // lock, empty journal, or expiry scan.
  return !state.reserved && !state.consumed ? [identity] : [accountLock(state.org), identity];
}
export async function finishSettlement(
  tx: Tx,
  plan: PreparedSettlement,
  results: readonly QueryResult<Record<string, unknown>>[],
) {
  const state = settlementPlans.get(plan);
  assert(
    state &&
      state.tx === tx &&
      state.transaction === transactionIdentity(tx) &&
      state.submitted &&
      !state.finished,
    500,
    'billing_state_stale',
    'Reload the current billing account before settlement.',
  );
  state.finished = true;
  const { org, reference, reserved, consumed } = state;
  if (!reserved && !consumed) return;
  const account = results[0]?.rows[0],
    seen = results[1];
  assert(
    account &&
      typeof account.reserved_micro_usd === 'string' &&
      typeof account.balance_micro_usd === 'string',
    500,
    'billing_unavailable',
    'The billing account is unavailable.',
  );
  if (!seen.rowCount) return;
  const journal = id();
  const completed = await queryGroup(tx, [
    // Allocation and any uncovered debt are one owned statement. Following
    // statements observe its changes before releasing the reservation/expiring
    // credit, without another application round trip between those mutations.
    ...(consumed ? [consumeLotsQuery(org, consumed)] : []),
    {
      text: 'INSERT INTO ledger(id,organization_id,journal_id,account,amount_micro_usd,reference) VALUES($1,$2,$3,$4,$5,$6),($7,$2,$3,$8,$9,$6)',
      values: [
        id(),
        org,
        journal,
        'consumption',
        consumed.toString(),
        reference,
        id(),
        'available_credits',
        (-consumed).toString(),
      ],
    },
    {
      text: 'UPDATE organizations SET balance_micro_usd=balance_micro_usd-$2::bigint,reserved_micro_usd=reserved_micro_usd-$3::bigint WHERE id=$1 RETURNING reserved_micro_usd',
      values: [org, consumed.toString(), reserved.toString()],
    },
    expiredLots(org),
  ]);
  const offset = consumed ? 1 : 0;
  const released = completed[offset + 1].rows[0];
  assert(
    released && typeof released.reserved_micro_usd === 'string',
    500,
    'billing_unavailable',
    'The current billing reservation is unavailable.',
  );
  // Another wallet operation can run between composed settlement phases in
  // this transaction. Expiry must protect the actual post-release reservations.
  await expireLockedCredits(
    tx,
    org,
    released.reserved_micro_usd,
    expiredLotsFromResult(completed[offset + 2]),
  );
}

/** Current projection protected by this transaction's organization row lock.
 * Reuse within that transaction only; it is never an available-balance cache. */
export type LockedAccount = {
  balance_micro_usd: string;
  reserved_micro_usd: string;
  settings: Record<string, unknown>;
  plan: string;
  run_concurrency_limit: number | null;
  run_timeout_seconds: number | null;
};
type ExpiredCreditLot = { id: string; remaining_micro_usd: string };
function accountLock(org: string) {
  return {
    text: 'SELECT balance_micro_usd,reserved_micro_usd,settings,plan,run_concurrency_limit,run_timeout_seconds FROM organizations WHERE id=$1 FOR NO KEY UPDATE',
    values: [org],
  };
}
function expiredLots(org: string, at?: Date) {
  return {
    // Use the clock when this ordered statement executes, after acquiring the
    // account lock. A long lock wait must not postpone credit expiry checks.
    text: 'SELECT id,remaining_micro_usd FROM credit_lots WHERE organization_id=$1 AND expires_at<=coalesce($2::timestamptz,clock_timestamp()) AND remaining_micro_usd>0 ORDER BY expires_at,created_at,id FOR UPDATE',
    values: [org, at ?? null],
  };
}
function decodeCreditState(results: readonly QueryResult<Record<string, unknown>>[]): CreditState {
  const row = results[0]?.rows[0];
  assert(
    row &&
      typeof row.balance_micro_usd === 'string' &&
      typeof row.reserved_micro_usd === 'string' &&
      typeof row.settings === 'object' &&
      row.settings !== null &&
      !Array.isArray(row.settings) &&
      typeof row.plan === 'string' &&
      (row.run_concurrency_limit === null || typeof row.run_concurrency_limit === 'number') &&
      (row.run_timeout_seconds === null || typeof row.run_timeout_seconds === 'number'),
    500,
    'billing_unavailable',
    'The billing account is unavailable.',
  );
  const account: LockedAccount = {
    balance_micro_usd: row.balance_micro_usd,
    reserved_micro_usd: row.reserved_micro_usd,
    settings: row.settings as Record<string, unknown>,
    plan: row.plan,
    run_concurrency_limit: row.run_concurrency_limit,
    run_timeout_seconds: row.run_timeout_seconds,
  };
  return { account, lots: expiredLotsFromResult(results[1]) };
}
function expiredLotsFromResult(result: QueryResult<Record<string, unknown>>): ExpiredCreditLot[] {
  return result.rows.map((lot) => {
    assert(
      typeof lot.id === 'string' && typeof lot.remaining_micro_usd === 'string',
      500,
      'billing_unavailable',
      'The credit lot is unavailable.',
    );
    return { id: lot.id, remaining_micro_usd: lot.remaining_micro_usd };
  });
}
async function lockedCreditState(tx: Tx, org: string, at?: Date) {
  return decodeCreditState(await queryGroup(tx, creditStateQueries(org, at)));
}

/** Reservations protect the earliest-expiring credit. Expiration removes only the unreserved
 * remainder; completion consumes the protected credit first and expires any released remainder. */
export async function expireCredits(tx: Tx, org: string, at = new Date()) {
  const { account, lots } = await lockedCreditState(tx, org, at);
  return expireLockedCredits(tx, org, account.reserved_micro_usd, lots);
}
async function expireLockedCredits(tx: Tx, org: string, reserved: string, lots: readonly ExpiredCreditLot[]) {
  const { total, entries: changes } = expirationChanges(reserved, lots);
  const encoded = total ? JSON.stringify(changes) : '';
  if (total)
    await tx.query(
      `WITH changed AS MATERIALIZED (
        SELECT * FROM jsonb_to_recordset($2::jsonb) AS entry(
          id uuid,remaining bigint,journal uuid,reference text,amount bigint,debit bigint,"creditId" uuid,"debitId" uuid)
      ), events AS (
        INSERT INTO financial_events(organization_id,reference) SELECT $1,reference FROM changed RETURNING reference
      ), journals AS (
        INSERT INTO ledger(id,organization_id,journal_id,account,amount_micro_usd,reference)
        SELECT entry.id,$1,changed.journal,entry.account,entry.amount,changed.reference
        FROM changed JOIN events USING(reference)
        CROSS JOIN LATERAL (VALUES (changed."creditId",'expired_credits',changed.amount),(changed."debitId",'available_credits',changed.debit)) AS entry(id,account,amount)
      ), lots AS (
        UPDATE credit_lots AS lot SET remaining_micro_usd=changed.remaining FROM changed
        WHERE lot.organization_id=$1 AND lot.id=changed.id
      ) UPDATE organizations SET balance_micro_usd=balance_micro_usd-$3::bigint WHERE id=$1`,
      [org, encoded, total.toString()],
    );
  return total;
}
function expirationChanges(reserved: string, lots: readonly ExpiredCreditLot[]) {
  let held = BigInt(reserved),
    total = 0n;
  const changes: {
    id: string;
    remaining: string;
    reference: string;
    journal: string;
    amount: string;
    debit: string;
    creditId: string;
    debitId: string;
    previous: string;
  }[] = [];
  for (const lot of lots) {
    const remaining = BigInt(lot.remaining_micro_usd),
      keep = held < remaining ? held : remaining,
      amount = remaining - keep;
    held -= keep;
    if (!amount) continue;
    changes.push({
      id: lot.id,
      previous: lot.remaining_micro_usd,
      remaining: keep.toString(),
      reference: `expiry:${lot.id}:${lot.remaining_micro_usd}`,
      journal: id(),
      amount: amount.toString(),
      debit: (-amount).toString(),
      creditId: id(),
      debitId: id(),
    });
    total += amount;
  }
  return { total, entries: changes };
}
async function consumeLots(tx: Tx, org: string, amount: bigint, preferredReference = '') {
  if (!amount) return;
  await tx.query(consumeLotsQuery(org, amount, preferredReference));
}
function consumeLotsQuery(org: string, amount: bigint, preferredReference = ''): QueryConfig {
  // The organization lock serializes allocation. One ordered lot snapshot and
  // one set-based debit preserve earliest expiry without a round trip per lot.
  return {
    text: `WITH locked AS MATERIALIZED (
      SELECT id,remaining_micro_usd,reference,expires_at,created_at FROM credit_lots
      WHERE organization_id=$1 AND remaining_micro_usd>0
      ORDER BY (reference=$3) DESC,expires_at NULLS LAST,created_at,id FOR UPDATE
    ), allocation AS (
      SELECT id,least(remaining_micro_usd,greatest($2::numeric-coalesce(sum(remaining_micro_usd) OVER (
        ORDER BY (reference=$3) DESC,expires_at NULLS LAST,created_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),0),0))::bigint AS amount FROM locked
    ), debited AS (
      UPDATE credit_lots AS lot SET remaining_micro_usd=lot.remaining_micro_usd-allocation.amount
      FROM allocation WHERE lot.id=allocation.id AND allocation.amount>0 RETURNING allocation.amount
    ), uncovered AS (
      SELECT $2::numeric-coalesce(sum(amount),0) AS amount FROM debited
    ) UPDATE organizations SET credit_debt_micro_usd=credit_debt_micro_usd+uncovered.amount::bigint
      FROM uncovered WHERE id=$1 AND uncovered.amount>0`,
    values: [org, amount.toString(), preferredReference],
  };
}
/** Refunds and adjustments append compensating journals. Already consumed funds become debt;
 * neither a payment reversal nor an administrative correction rewrites historical usage. */
export async function debit(
  tx: Tx,
  org: string,
  amount: bigint,
  reference: string,
  account = 'refunds',
  preferredReference?: string,
) {
  assert(amount >= 0n, 400, 'invalid_amount', 'Debit must be nonnegative.');
  await tx.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [org]);
  const seen = await tx.query(
    'INSERT INTO financial_events(organization_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING reference',
    [org, reference],
  );
  if (!seen.rowCount) return false;
  const journal = id();
  await consumeLots(tx, org, amount, preferredReference);
  await tx.query(
    'INSERT INTO ledger(id,organization_id,journal_id,account,amount_micro_usd,reference) VALUES($1,$2,$3,$4,$5,$6),($7,$2,$3,$8,$9,$6)',
    [
      id(),
      org,
      journal,
      account,
      amount.toString(),
      reference,
      id(),
      'available_credits',
      (-amount).toString(),
    ],
  );
  await tx.query('UPDATE organizations SET balance_micro_usd=balance_micro_usd-$2::bigint WHERE id=$1', [
    org,
    amount.toString(),
  ]);
  return true;
}
