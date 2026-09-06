import { it, expect, afterAll } from 'vitest';
import { pool, authPool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import { credit, reserve } from '../../packages/core/src/ledger';
import { reconcileFinance } from '../../packages/core/src/maintenance';
import { billing } from '../../packages/core/src/reports';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('expires credit, checks independent projections, fails closed on drift and keeps reports read-only', async () => {
  const org = id();
  await pool.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [org, 'Maintenance fixture']);
  await transaction(org, async (tx) => {
    await credit(tx, org, 2000000n, 'fixture:purchased');
    await credit(tx, org, 500000n, 'fixture:monthly', 'subscription_credits', new Date(Date.now() - 3600000));
    const journals = Number((await tx.query('SELECT count(*) FROM ledger')).rows[0].count);
    expect((await billing(tx, org)).available_micro_usd).toBe('2000000');
    expect(Number((await tx.query('SELECT count(*) FROM ledger')).rows[0].count)).toBe(journals);
    expect((await reconcileFinance(tx, org)).status).toBe('balanced');
    expect(
      (await tx.query('SELECT balance_micro_usd FROM organizations WHERE id=$1', [org])).rows[0]
        .balance_micro_usd,
    ).toBe('2000000');
    expect((await reconcileFinance(tx, org)).status).toBe('balanced');
    expect(Number((await tx.query('SELECT count(*) FROM ledger')).rows[0].count)).toBe(journals + 2);
    await tx.query('UPDATE organizations SET balance_micro_usd=balance_micro_usd+1 WHERE id=$1', [org]);
    expect((await reconcileFinance(tx, org)).issues).toEqual([
      'credit_lot_balance_mismatch',
      'ledger_balance_mismatch',
    ]);
  });
  await expect(transaction(org, (tx) => reserve(tx, org, 100n))).rejects.toMatchObject({
    code: 'billing_hold',
  });
  await transaction(org, async (tx) => {
    await tx.query('UPDATE organizations SET balance_micro_usd=balance_micro_usd-1 WHERE id=$1', [org]);
    expect((await reconcileFinance(tx, org)).status).toBe('balanced');
    await tx.query('UPDATE organizations SET reserved_micro_usd=100 WHERE id=$1', [org]);
    expect((await reconcileFinance(tx, org)).issues).toEqual(['reservation_balance_mismatch']);
  });
});
