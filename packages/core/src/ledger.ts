import { queryGroup, type Tx } from '../../db';
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
export async function reserve(tx: Tx, org: string, amount: bigint) {
  const { account: row, lots } = await lockedCreditState(tx, org);
  const expired = await expireLockedCredits(tx, org, row.reserved_micro_usd, lots);
  assert(
    !row.settings.billing_hold && !row.settings.payment_dispute_hold && !row.settings.reconciliation_hold,
    402,
    'billing_hold',
    'Resolve the payment issue in Billing before starting new work.',
  );
  assert(
    BigInt(row.balance_micro_usd) - expired - BigInt(row.reserved_micro_usd) >= amount,
    402,
    'insufficient_credit',
    'Add credits or reduce the maximum run budget.',
  );
  // The organization lock and every hold/credit check still apply to BYOK;
  // reserving zero needs no redundant write to the already locked wallet.
  if (amount)
    await tx.query('UPDATE organizations SET reserved_micro_usd=reserved_micro_usd+$2::bigint WHERE id=$1', [
      org,
      amount.toString(),
    ]);
  return {
    ...row,
    balance_micro_usd: (BigInt(row.balance_micro_usd) - expired).toString(),
    reserved_micro_usd: (BigInt(row.reserved_micro_usd) + amount).toString(),
  };
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
  assert(
    consumed >= 0n && consumed <= reserved,
    409,
    'budget_exceeded',
    'Usage exceeds the authorized reservation.',
  );
  if (reserved === 0n && consumed === 0n) {
    // There is no wallet change or released hold to serialize. Retain business
    // deduplication without empty journals, balance rewrites or expiry scans.
    await tx.query(
      'INSERT INTO financial_events(organization_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [org, reference],
    );
    return;
  }
  // Preserve organization-before-business-identity order. Neither statement
  // needs a JavaScript decision from the preceding result.
  const [accounts, seen] = await queryGroup<LockedAccount | { reference: string }>(tx, [
    accountLock(org),
    {
      text: 'INSERT INTO financial_events(organization_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING reference',
      values: [org, reference],
    },
  ]);
  const account = accounts.rows[0];
  assert(
    account && 'balance_micro_usd' in account,
    500,
    'billing_unavailable',
    'The billing account is unavailable.',
  );
  if (!seen.rowCount) return;
  await consumeLots(tx, org, consumed);
  const journal = id();
  const completed = await queryGroup<ExpiredCreditLot>(tx, [
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
      text: 'UPDATE organizations SET balance_micro_usd=balance_micro_usd-$2::bigint,reserved_micro_usd=reserved_micro_usd-$3::bigint WHERE id=$1',
      values: [org, consumed.toString(), reserved.toString()],
    },
    expiredLots(org),
  ]);
  await expireLockedCredits(
    tx,
    org,
    (BigInt(account.reserved_micro_usd) - reserved).toString(),
    completed[2].rows,
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
async function lockedCreditState(tx: Tx, org: string, at?: Date) {
  const [accounts, expired] = await queryGroup<LockedAccount | ExpiredCreditLot>(tx, [
    accountLock(org),
    expiredLots(org, at),
  ]);
  const account = accounts.rows[0];
  assert(
    account && 'balance_micro_usd' in account,
    500,
    'billing_unavailable',
    'The billing account is unavailable.',
  );
  const lots = expired.rows.map((lot) => {
    assert('remaining_micro_usd' in lot, 500, 'billing_unavailable', 'The credit lot is unavailable.');
    return lot;
  });
  return { account, lots };
}

/** Reservations protect the earliest-expiring credit. Expiration removes only the unreserved
 * remainder; completion consumes the protected credit first and expires any released remainder. */
export async function expireCredits(tx: Tx, org: string, at = new Date()) {
  const { account, lots } = await lockedCreditState(tx, org, at);
  return expireLockedCredits(tx, org, account.reserved_micro_usd, lots);
}
async function expireLockedCredits(tx: Tx, org: string, reserved: string, lots: readonly ExpiredCreditLot[]) {
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
  }[] = [];
  for (const lot of lots) {
    const remaining = BigInt(lot.remaining_micro_usd),
      keep = held < remaining ? held : remaining,
      amount = remaining - keep;
    held -= keep;
    if (!amount) continue;
    changes.push({
      id: lot.id,
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
async function consumeLots(tx: Tx, org: string, amount: bigint, preferredReference = '') {
  if (!amount) return;
  // The organization lock serializes allocation. One ordered lot snapshot and
  // one set-based debit preserve earliest expiry without a round trip per lot.
  const consumed = (
    await tx.query<{ amount: string }>(
      `WITH locked AS MATERIALIZED (
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
    ) SELECT coalesce(sum(amount),0)::text AS amount FROM debited`,
      [org, amount.toString(), preferredReference],
    )
  ).rows[0];
  const left = amount - BigInt(consumed.amount);
  if (left)
    await tx.query(
      'UPDATE organizations SET credit_debt_micro_usd=credit_debt_micro_usd+$2::bigint WHERE id=$1',
      [org, left.toString()],
    );
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
