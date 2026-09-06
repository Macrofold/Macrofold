import type { Tx } from '../../db';
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
  await expireCredits(tx, org);
  const row = (await tx.query('SELECT * FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [org])).rows[0];
  assert(
    !row.settings.billing_hold && !row.settings.payment_dispute_hold && !row.settings.reconciliation_hold,
    402,
    'billing_hold',
    'Resolve the payment issue in Billing before starting new work.',
  );
  assert(
    BigInt(row.balance_micro_usd) - BigInt(row.reserved_micro_usd) >= amount,
    402,
    'insufficient_credit',
    'Add credits or reduce the maximum run budget.',
  );
  await tx.query('UPDATE organizations SET reserved_micro_usd=reserved_micro_usd+$2::bigint WHERE id=$1', [
    org,
    amount.toString(),
  ]);
}
export async function settle(tx: Tx, org: string, runId: string, reserved: bigint, consumed: bigint) {
  await tx.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [org]);
  assert(
    consumed >= 0n && consumed <= reserved,
    409,
    'budget_exceeded',
    'Usage exceeds the authorized reservation.',
  );
  const reference = `run:${runId}`;
  const seen = await tx.query(
    'INSERT INTO financial_events(organization_id,reference) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING reference',
    [org, reference],
  );
  if (!seen.rowCount) return;
  await consumeLots(tx, org, consumed);
  const journal = id();
  await tx.query(
    'INSERT INTO ledger(id,organization_id,journal_id,account,amount_micro_usd,reference) VALUES($1,$2,$3,$4,$5,$6),($7,$2,$3,$8,$9,$6)',
    [
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
  );
  await tx.query(
    'UPDATE organizations SET balance_micro_usd=balance_micro_usd-$2::bigint,reserved_micro_usd=reserved_micro_usd-$3::bigint WHERE id=$1',
    [org, consumed.toString(), reserved.toString()],
  );
  await expireCredits(tx, org);
}

/** Reservations protect the earliest-expiring credit. Expiration removes only the unreserved
 * remainder; completion consumes the protected credit first and expires any released remainder. */
export async function expireCredits(tx: Tx, org: string, at = new Date()) {
  const row = (
    await tx.query('SELECT reserved_micro_usd FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [org])
  ).rows[0];
  let held = BigInt(row.reserved_micro_usd),
    total = 0n;
  const lots = await tx.query(
    'SELECT * FROM credit_lots WHERE expires_at<=$1 AND remaining_micro_usd>0 ORDER BY expires_at,created_at,id FOR UPDATE',
    [at],
  );
  for (const lot of lots.rows) {
    const remaining = BigInt(lot.remaining_micro_usd),
      keep = held < remaining ? held : remaining,
      amount = remaining - keep;
    held -= keep;
    if (!amount) continue;
    const reference = `expiry:${lot.id}:${lot.remaining_micro_usd}`,
      journal = id();
    await tx.query('INSERT INTO financial_events(organization_id,reference) VALUES($1,$2)', [org, reference]);
    await tx.query(
      'INSERT INTO ledger(id,organization_id,journal_id,account,amount_micro_usd,reference) VALUES($1,$2,$3,$4,$5,$6),($7,$2,$3,$8,$9,$6)',
      [
        id(),
        org,
        journal,
        'expired_credits',
        amount.toString(),
        reference,
        id(),
        'available_credits',
        (-amount).toString(),
      ],
    );
    await tx.query('UPDATE credit_lots SET remaining_micro_usd=$2 WHERE id=$1', [lot.id, keep.toString()]);
    total += amount;
  }
  if (total)
    await tx.query('UPDATE organizations SET balance_micro_usd=balance_micro_usd-$2::bigint WHERE id=$1', [
      org,
      total.toString(),
    ]);
  return total;
}
async function consumeLots(tx: Tx, org: string, amount: bigint, preferredReference = '') {
  let left = amount;
  const lots = await tx.query(
    'SELECT id,remaining_micro_usd FROM credit_lots WHERE remaining_micro_usd>0 ORDER BY (reference=$1) DESC,expires_at NULLS LAST,created_at,id FOR UPDATE',
    [preferredReference],
  );
  for (const lot of lots.rows) {
    if (!left) break;
    const value = BigInt(lot.remaining_micro_usd),
      take = value < left ? value : left;
    await tx.query('UPDATE credit_lots SET remaining_micro_usd=remaining_micro_usd-$2::bigint WHERE id=$1', [
      lot.id,
      take.toString(),
    ]);
    left -= take;
  }
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
