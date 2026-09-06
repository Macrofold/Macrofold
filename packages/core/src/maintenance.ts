import { pool, authPool, transaction, type Tx } from '../../db';
import { expireCredits } from './ledger';

/** Recompute projections from independent facts. A mismatch stops new reservations and
 * surfaces evidence; maintenance never invents a compensating financial journal. */
export async function reconcileFinance(tx: Tx, org: string) {
  await expireCredits(tx, org);
  const row = (
    await tx.query(
      'SELECT balance_micro_usd,reserved_micro_usd,credit_debt_micro_usd FROM organizations WHERE id=$1 FOR NO KEY UPDATE',
      [org],
    )
  ).rows[0];
  const remaining = (
    await tx.query('SELECT coalesce(sum(remaining_micro_usd),0)::text AS value FROM credit_lots')
  ).rows[0].value;
  const reserved = (
    await tx.query(
      "SELECT coalesce(sum(reservation_micro_usd),0)::text AS value FROM runs WHERE status IN ('queued','provisioning','running','waiting_for_input','persisting')",
    )
  ).rows[0].value;
  const invalidJournals = (
    await tx.query(
      'SELECT count(*)::text AS value FROM (SELECT journal_id FROM ledger GROUP BY journal_id HAVING sum(amount_micro_usd)<>0 OR count(*)<2) broken',
    )
  ).rows[0].value;
  const ledgerBalance = (
    await tx.query(
      "SELECT coalesce(sum(amount_micro_usd),0)::text AS value FROM ledger WHERE account='available_credits' OR account IN (SELECT DISTINCT kind FROM credit_lots)",
    )
  ).rows[0].value;
  const issues: string[] = [];
  if (BigInt(remaining) - BigInt(row.credit_debt_micro_usd) !== BigInt(row.balance_micro_usd))
    issues.push('credit_lot_balance_mismatch');
  if (BigInt(reserved) !== BigInt(row.reserved_micro_usd)) issues.push('reservation_balance_mismatch');
  if (BigInt(ledgerBalance) !== BigInt(row.balance_micro_usd)) issues.push('ledger_balance_mismatch');
  if (BigInt(invalidJournals) > 0n) issues.push('unbalanced_journal');
  const financial = {
    status: issues.length ? 'attention' : 'balanced',
    issues,
    balance_micro_usd: row.balance_micro_usd,
    ledger_balance_micro_usd: ledgerBalance,
    credit_lot_remaining_micro_usd: remaining,
    credit_debt_micro_usd: row.credit_debt_micro_usd,
    reserved_micro_usd: row.reserved_micro_usd,
    expected_reserved_micro_usd: reserved,
    unbalanced_journals: invalidJournals,
  };
  await tx.query(
    "UPDATE organizations SET settings=settings||jsonb_build_object('reconciliation_hold',$2::boolean) WHERE id=$1",
    [org, !!issues.length],
  );
  await tx.query(
    'INSERT INTO maintenance_observations(organization_id,observed_at,financial) VALUES($1,now(),$2) ON CONFLICT(organization_id) DO UPDATE SET observed_at=excluded.observed_at,financial=excluded.financial',
    [org, JSON.stringify(financial)],
  );
  return financial;
}
export async function dispatchOrganizationMaintenance() {
  // Claims rotate fairly and recover after a worker disappears. Financial checks do no provider IO.
  const claims =
    await pool.query(`WITH candidates AS (SELECT id FROM organizations WHERE maintenance_due_at<=now() ORDER BY maintenance_due_at LIMIT 5 FOR NO KEY UPDATE SKIP LOCKED)
    UPDATE organizations o SET maintenance_due_at=now()+interval '1 hour' FROM candidates c WHERE o.id=c.id RETURNING o.id`);
  let completed = 0;
  for (const org of claims.rows) {
    try {
      await transaction(org.id, async (tx) => {
        await reconcileFinance(tx, org.id);
        await tx.query("DELETE FROM oauth_attempts WHERE expires_at<now()-interval '1 day'");
        await tx.query('DELETE FROM github_user_links WHERE expires_at<now()');
        await tx.query("DELETE FROM organization_invitations WHERE expires_at<now()-interval '30 days'");
        // Keep idempotency responses for 30 days; this includes one-time key/invitation secrets.
        await tx.query("DELETE FROM idempotency WHERE created_at<now()-interval '30 days'");
        // Activity is metadata, not accounting. Delete bounded batches so a long outage
        // cannot turn routine maintenance into an unbounded vacuum/locking workload.
        await tx.query(
          "DELETE FROM actor_activity WHERE id IN (SELECT id FROM actor_activity WHERE created_at<now()-interval '400 days' ORDER BY created_at LIMIT 10000)",
        );
      });
      completed++;
    } catch {
      await pool.query("UPDATE organizations SET maintenance_due_at=now()+interval '5 minutes' WHERE id=$1", [
        org.id,
      ]);
    }
  }
  await pool.query("DELETE FROM github_webhook_receipts WHERE received_at<now()-interval '90 days'");
  await pool.query('DELETE FROM rate_limits WHERE bucket<$1', [Math.floor(Date.now() / 60000) - 60]);
  await authPool.query(
    'DELETE FROM auth."rateLimit" WHERE id IN (SELECT id FROM auth."rateLimit" WHERE "lastRequest"<$1 ORDER BY "lastRequest" LIMIT 10000)',
    [Date.now() - 86400000],
  );
  await pool.query(
    "DELETE FROM api_requests WHERE request_id IN (SELECT request_id FROM api_requests WHERE created_at<now()-interval '400 days' ORDER BY created_at LIMIT 10000)",
  );
  await pool.query(
    "DELETE FROM product_events WHERE id IN (SELECT id FROM product_events WHERE created_at<now()-interval '400 days' ORDER BY created_at LIMIT 10000)",
  );
  return { organizations_checked: completed };
}
