import { it, expect, afterAll, afterEach } from 'vitest';
import Stripe from 'stripe';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { id } from '../../packages/core/src/crypto';
import { credit, debit, reserve, settle, expireCredits } from '../../packages/core/src/ledger';
import { processStripeEvent } from '../../packages/core/src/billing-events';
import { stripeWebhook, checkout } from '../../packages/core/src/billing';
import { config } from '../../packages/core/src/config';
const env = { ...process.env };
afterEach(() => {
  for (const k of [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRO_PRICE_ID',
    'PRO_INCLUDED_CREDIT_MICRO_USD',
    'STRIPE_SCALE_PRICE_ID',
    'SCALE_INCLUDED_CREDIT_MICRO_USD',
  ]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
const event = (type: string, object: unknown, created = Math.floor(Date.now() / 1000)) =>
  ({
    id: 'evt_' + id(),
    type,
    data: { object },
    created,
    object: 'event',
    livemode: false,
    pending_webhooks: 1,
    request: null,
    api_version: '2025-12-15.clover',
  }) as Stripe.Event;
const forbidden = async () => {
  throw new Error('Unexpected Stripe request; no network is allowed');
};
const provider = {
  subscriptions: { retrieve: forbidden },
  charges: { retrieve: forbidden },
  invoicePayments: { list: forbidden },
} as unknown as Pick<Stripe, 'subscriptions' | 'charges' | 'invoicePayments'>;
it('uses approved tier prices and never reuses an open checkout for a different plan', async () => {
  process.env.STRIPE_PRO_PRICE_ID = 'price_pro_fixture';
  process.env.STRIPE_SCALE_PRICE_ID = 'price_scale_fixture';
  const a = await fixtureAccount('Tier checkout');
  const calls: Stripe.Checkout.SessionCreateParams[] = [];
  const stub = {
    customers: { create: async () => ({ id: 'cus_' + id() }) },
    checkout: {
      sessions: {
        create: async (input: Stripe.Checkout.SessionCreateParams) => {
          calls.push(input);
          return {
            id: 'cs_' + id(),
            url: 'https://checkout.stripe.com/test-fixture',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          };
        },
      },
    },
  } as unknown as Pick<Stripe, 'customers' | 'checkout'>;
  const create = (plan: 'pro' | 'scale') =>
    transaction(a.p.organizationId, (tx) => checkout(tx, a.p, { kind: 'subscription', plan }, id(), stub));
  await create('pro');
  await create('pro');
  expect(calls).toHaveLength(1);
  expect(calls[0].line_items).toEqual([{ price: 'price_pro_fixture', quantity: 1 }]);
  await expect(create('scale')).rejects.toMatchObject({ code: 'checkout_pending' });
  expect(calls).toHaveLength(1);
  await transaction(a.p.organizationId, (tx) =>
    tx.query("UPDATE billing_orders SET expires_at=now()-interval '1 second'"),
  );
  await create('scale');
  expect(calls[1].line_items).toEqual([{ price: 'price_scale_fixture', quantity: 1 }]);
  await pool.query("UPDATE organizations SET plan='scale' WHERE id=$1", [a.p.organizationId]);
  await expect(create('pro')).rejects.toMatchObject({ code: 'subscription_exists' });
  expect(calls).toHaveLength(2);
});
async function balance(org: string) {
  return transaction(org, async (tx) => {
    const row = (
      await tx.query(
        'SELECT balance_micro_usd,credit_debt_micro_usd,reserved_micro_usd FROM organizations WHERE id=$1',
        [org],
      )
    ).rows[0];
    const sum = BigInt(
      (await tx.query('SELECT COALESCE(sum(remaining_micro_usd),0) AS value FROM credit_lots')).rows[0].value,
    );
    expect(sum - BigInt(row.credit_debt_micro_usd)).toBe(BigInt(row.balance_micro_usd));
    expect(
      (await tx.query('SELECT journal_id FROM ledger GROUP BY journal_id HAVING sum(amount_micro_usd)<>0'))
        .rowCount,
    ).toBe(0);
    return BigInt(row.balance_micro_usd);
  });
}
async function order() {
  const a = await fixtureAccount('Billing fixture'),
    order = id(),
    session = 'cs_' + id(),
    customer = 'cus_' + id(),
    payment = 'pi_' + id();
  await pool.query('UPDATE organizations SET settings=$2 WHERE id=$1', [
    a.p.organizationId,
    JSON.stringify({ stripe_customer_id: customer }),
  ]);
  await transaction(a.p.organizationId, (tx) =>
    tx.query(
      "INSERT INTO billing_orders(id,organization_id,request_key,kind,expected_micro_usd,customer_id,session_id) VALUES($1,$2,$3,'topup',20000000,$4,$5)",
      [order, a.p.organizationId, id(), customer, session],
    ),
  );
  const object = {
    id: session,
    customer,
    payment_intent: payment,
    mode: 'payment',
    payment_status: 'paid',
    currency: 'usd',
    amount_total: 2000,
    metadata: { organization_id: a.p.organizationId, kind: 'topup', order_id: order },
  };
  return { ...a, order, customer, payment, object };
}
it('verifies real Stripe signatures, binds paid amounts to orders and deduplicates separate payment events', async () => {
  const o = await order();
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture_no_real_account';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
  const e = event('checkout.session.completed', o.object),
    body = JSON.stringify(e);
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });
  const request = () =>
    new Request(config.origin + '/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': signature },
      body,
    });
  expect((await stripeWebhook(request())).status).toBe(200);
  await stripeWebhook(request());
  await processStripeEvent(event('checkout.session.async_payment_succeeded', o.object), provider);
  expect(await balance(o.p.organizationId)).toBe(20000000n);
  await expect(
    stripeWebhook(
      new Request(config.origin + '/webhooks/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': signature },
        body: body + ' ',
      }),
    ),
  ).rejects.toMatchObject({ code: 'invalid_signature' });
  const other = await order();
  await expect(
    processStripeEvent(
      event('checkout.session.completed', { ...other.object, amount_total: 2001 }),
      provider,
    ),
  ).rejects.toMatchObject({ code: 'payment_mismatch' });
  expect(await balance(other.p.organizationId)).toBe(0n);
});
it('protects running reservations at expiration, consumes earliest credit and rejects ledger mutation', async () => {
  const a = await fixtureAccount('Credit expiration');
  const org = a.p.organizationId;
  await transaction(org, async (tx) => {
    await credit(tx, org, 10000000n, 'included', 'subscription_credits', new Date(Date.now() + 3600000));
    await credit(tx, org, 20000000n, 'purchased');
    await reserve(tx, org, 6000000n);
    await tx.query("UPDATE credit_lots SET expires_at=now()-interval '1 minute' WHERE reference='included'");
    expect(await expireCredits(tx, org)).toBe(4000000n);
  });
  expect(await balance(org)).toBe(26000000n);
  await transaction(org, (tx) => settle(tx, org, id(), 6000000n, 3000000n));
  expect(await balance(org)).toBe(20000000n);
  await expect(
    transaction(org, (tx) => tx.query('UPDATE ledger SET amount_micro_usd=0')),
  ).rejects.toMatchObject({ code: '42501' });
  await transaction(org, async (tx) => {
    await debit(tx, org, 25000000n, 'refund');
    expect(
      (await tx.query('SELECT credit_debt_micro_usd FROM organizations WHERE id=$1', [org])).rows[0]
        .credit_debt_micro_usd,
    ).toBe('5000000');
    await credit(tx, org, 10000000n, 'recovery');
  });
  expect(await balance(org)).toBe(5000000n);
  await expect(transaction(org, (tx) => reserve(tx, org, 6000000n))).rejects.toMatchObject({
    code: 'insufficient_credit',
  });
});
it('caps overlapping refunds/disputes, freezes new work, ignores old dispute state and compensates a win', async () => {
  const o = await order();
  await processStripeEvent(event('checkout.session.completed', o.object), provider);
  const charge = {
    id: 'ch_' + id(),
    customer: o.customer,
    payment_intent: o.payment,
    amount: 2000,
    amount_refunded: 500,
  };
  const refund = event('charge.refunded', charge);
  await processStripeEvent(refund, provider);
  await processStripeEvent(refund, provider);
  expect(await balance(o.p.organizationId)).toBe(15000000n);
  const fake = { ...provider, charges: { retrieve: async () => charge } } as unknown as typeof provider;
  const dispute = { id: 'dp_' + id(), charge: charge.id, amount: 2000, status: 'needs_response' },
    opened = event('charge.dispute.created', dispute, 100),
    closed = event('charge.dispute.closed', { ...dispute, status: 'won' }, 200);
  await processStripeEvent(opened, fake);
  expect(await balance(o.p.organizationId)).toBe(0n);
  await expect(
    transaction(o.p.organizationId, (tx) => reserve(tx, o.p.organizationId, 0n)),
  ).rejects.toMatchObject({ code: 'billing_hold' });
  await processStripeEvent(closed, fake);
  expect(await balance(o.p.organizationId)).toBe(15000000n);
  await processStripeEvent(event('charge.dispute.updated', dispute, 150), fake);
  expect(await balance(o.p.organizationId)).toBe(15000000n);
  await transaction(o.p.organizationId, (tx) => reserve(tx, o.p.organizationId, 0n));
});
it.each([
  { plan: 'pro', price: 2900, included: 10000000n },
  { plan: 'scale', price: 19900, included: 50000000n },
])(
  'grants $plan paid monthly inclusion once and reconciles current subscription state',
  async ({ plan, price, included }) => {
    const o = await order(),
      org = o.p.organizationId;
    process.env[`STRIPE_${plan.toUpperCase()}_PRICE_ID`] = 'price_fixture';
    const subscription = {
      id: 'sub_' + id(),
      customer: o.customer,
      created: 100,
      status: 'active',
      items: {
        data: [
          {
            quantity: 1,
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
            price: { id: 'price_fixture', recurring: { interval: 'month', interval_count: 1 } },
          },
        ],
      },
    };
    const invoice = {
      id: 'in_' + id(),
      customer: o.customer,
      currency: 'usd',
      amount_paid: price,
      status: 'paid',
      billing_reason: 'subscription_cycle',
      parent: { subscription_details: { subscription: subscription.id } },
      lines: {
        data: [
          {
            pricing: { price_details: { price: 'price_fixture' } },
            parent: { type: 'subscription_item_details' },
            period: { end: Math.floor(Date.now() / 1000) + 86400 },
          },
        ],
      },
    };
    const payment = 'pi_' + id(),
      fake = {
        ...provider,
        subscriptions: { retrieve: async () => subscription },
        invoicePayments: {
          list: async () => ({
            has_more: false,
            data: [
              {
                payment: { type: 'payment_intent', payment_intent: payment },
                amount_paid: price,
                currency: 'usd',
              },
            ],
          }),
        },
      } as unknown as typeof provider;
    await processStripeEvent(event('invoice.paid', invoice), fake);
    await processStripeEvent(event('invoice.paid', invoice), fake);
    expect(await balance(org)).toBe(included);
    expect((await pool.query('SELECT plan FROM organizations WHERE id=$1', [org])).rows[0].plan).toBe(plan);
    subscription.status = 'past_due';
    await processStripeEvent(event('invoice.payment_failed', invoice), fake);
    await expect(transaction(org, (tx) => reserve(tx, org, 0n))).rejects.toMatchObject({
      code: 'billing_hold',
    });
    subscription.status = 'canceled';
    await processStripeEvent(
      event('customer.subscription.updated', { ...subscription, status: 'active' }),
      fake,
    );
    expect((await pool.query('SELECT plan FROM organizations WHERE id=$1', [org])).rows[0].plan).toBe('payg');
    await transaction(org, async (tx) => {
      await tx.query("UPDATE credit_lots SET expires_at=now()-interval '1 minute'");
      await expireCredits(tx, org);
    });
    expect(await balance(org)).toBe(0n);
    await processStripeEvent(
      event('charge.refunded', {
        id: 'ch_' + id(),
        customer: o.customer,
        payment_intent: payment,
        amount_refunded: 2900,
      }),
      fake,
    );
    expect(await balance(org)).toBe(0n); // Already-expired unused credit cannot be debited a second time.
  },
);
