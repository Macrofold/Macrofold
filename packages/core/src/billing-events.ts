import { subscriptionPlan } from './plans';
import type Stripe from 'stripe';
import { pool, transaction, lock, type Tx } from '../../db';
import { stripe } from './billing';
import { assert } from './errors';
import { credit, debit, expireCredits } from './ledger';
type BillingProvider = Pick<Stripe, 'subscriptions' | 'charges' | 'disputes' | 'invoicePayments'>;
const ref = (value: string | { id: string } | null | undefined) =>
  typeof value === 'string' ? value : value?.id;
async function organization(customer: string | { id: string } | null | undefined) {
  if (!customer) return undefined;
  return (
    await pool.query("SELECT id FROM organizations WHERE settings->>'stripe_customer_id'=$1", [ref(customer)])
  ).rows[0]?.id as string | undefined;
}
async function once(org: string | null, event: Stripe.Event, fn: (tx: Tx) => Promise<void>) {
  await transaction(org, async (tx) => {
    await lock(tx, `stripe-event:${event.id}`);
    const seen = await tx.query(
      'INSERT INTO billing_events(id,type) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',
      [event.id, event.type],
    );
    if (!seen.rowCount) return;
    if (org) await tx.query('SELECT id FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [org]);
    await fn(tx);
  });
}
async function subscriptionState(tx: Tx, org: string, sub: Stripe.Subscription) {
  const plan = subscriptionPlan(sub.items.data[0]?.price.id);
  const valid =
    sub.items.data.length === 1 &&
    Boolean(plan) &&
    sub.items.data[0].price.recurring?.interval === 'month' &&
    sub.items.data[0].price.recurring.interval_count === 1 &&
    sub.items.data[0].quantity === 1;
  const old = (await tx.query('SELECT settings FROM organizations WHERE id=$1', [org])).rows[0].settings;
  // A delayed event for an older subscription cannot overwrite a replacement subscription.
  if (Number(old.stripe_subscription_created || 0) > sub.created) return;
  await tx.query('UPDATE organizations SET plan=$2,settings=settings||$3::jsonb WHERE id=$1', [
    org,
    valid && ['active', 'trialing'].includes(sub.status) ? plan!.id : 'payg',
    JSON.stringify({
      stripe_subscription_id: sub.id,
      stripe_subscription_created: sub.created,
      billing_status: sub.status,
      billing_hold: ['past_due', 'unpaid', 'incomplete'].includes(sub.status),
      subscription_current_period_end: sub.items.data[0]?.current_period_end || null,
    }),
  ]);
}
/** Verified webhook payloads identify work. Current subscription state comes from Stripe so an
 * out-of-order notification cannot restore a cancelled plan. Every financial write is idempotent. */
export async function processStripeEvent(event: Stripe.Event, provider: BillingProvider = stripe()) {
  if ((await pool.query('SELECT 1 FROM billing_events WHERE id=$1', [event.id])).rowCount) return;
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded' ||
    event.type === 'checkout.session.expired'
  ) {
    const session = event.data.object,
      org = await organization(session.customer);
    if (!org || !session.metadata?.order_id) return;
    await once(org, event, async (tx) => {
      const order = (
        await tx.query('SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE', [session.metadata!.order_id])
      ).rows[0];
      assert(
        order &&
          order.organization_id === org &&
          order.customer_id === ref(session.customer) &&
          order.session_id === session.id &&
          session.metadata!.organization_id === org &&
          session.metadata!.kind === order.kind,
        503,
        'billing_order_unavailable',
        'Payment order is unavailable or inconsistent. The payment event will be retried.',
      );
      if (event.type === 'checkout.session.expired') {
        await tx.query("UPDATE billing_orders SET status='expired' WHERE id=$1 AND status='pending'", [
          order.id,
        ]);
        return;
      }
      if (session.payment_status !== 'paid') return;
      if (order.kind === 'topup') {
        const amount = BigInt(session.amount_total || 0) * 10000n,
          payment = ref(session.payment_intent);
        assert(
          session.mode === 'payment' &&
            session.currency === 'usd' &&
            amount > 0n &&
            amount === BigInt(order.expected_micro_usd) &&
            payment,
          409,
          'payment_mismatch',
          'The paid amount does not match this order.',
        );
        await credit(tx, org, amount, `stripe:checkout:${session.id}`);
        await tx.query(
          'INSERT INTO billing_payments(payment_intent_id,organization_id,reference,cash_micro_usd,funded_micro_usd) VALUES($1,$2,$3,$4,$4) ON CONFLICT(payment_intent_id) DO NOTHING',
          [payment, org, `stripe:checkout:${session.id}`, amount.toString()],
        );
      }
      await tx.query("UPDATE billing_orders SET status='paid' WHERE id=$1", [order.id]);
    });
    return;
  }
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const org = await organization(event.data.object.customer);
    if (!org) return;
    await once(org, event, async (tx) =>
      subscriptionState(tx, org, await provider.subscriptions.retrieve(event.data.object.id)),
    );
    return;
  }
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const invoice = event.data.object,
      org = await organization(invoice.customer),
      subscription = ref(invoice.parent?.subscription_details?.subscription);
    if (!org || !subscription) return;
    const line = invoice.lines.data.find(
      (l) =>
        Boolean(subscriptionPlan(ref(l.pricing?.price_details?.price))) &&
        l.parent?.type === 'subscription_item_details',
    );
    const eligible =
      event.type === 'invoice.paid' &&
      invoice.status === 'paid' &&
      invoice.currency === 'usd' &&
      invoice.amount_paid > 0 &&
      ['subscription_create', 'subscription_cycle'].includes(invoice.billing_reason || '') &&
      line;
    const payments = eligible
      ? await provider.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 100 })
      : undefined;
    assert(
      !payments?.has_more,
      409,
      'invoice_payment_limit',
      'This invoice needs manual reconciliation before granting credits.',
    );
    await once(org, event, async (tx) => {
      const current = await provider.subscriptions.retrieve(subscription);
      await subscriptionState(tx, org, current);
      if (!eligible || !line || !payments) return;
      assert(
        ref(current.customer) === ref(invoice.customer),
        409,
        'payment_mismatch',
        'Subscription customer mismatch.',
      );
      const amount = BigInt(
          subscriptionPlan(ref(line.pricing?.price_details?.price))!.included_credit_micro_usd,
        ),
        expires = new Date(line.period.end * 1000);
      assert(
        amount > 0n && amount <= 1000000000n,
        503,
        'invalid_credit_configuration',
        'Configure the included monthly credit amount.',
      );
      const valid = payments.data.filter(
        (p) => p.payment.type === 'payment_intent' && p.amount_paid && p.currency === 'usd',
      );
      const cash = valid.reduce((sum, p) => sum + BigInt(p.amount_paid!) * 10000n, 0n);
      assert(
        cash === BigInt(invoice.amount_paid) * 10000n,
        409,
        'invoice_payment_unsupported',
        'Invoice funding must be reconciled before granting credits.',
      );
      const reference = `stripe:invoice:${invoice.id}`;
      if (await credit(tx, org, amount, reference, 'subscription_credits', expires)) {
        let allocated = 0n;
        for (let i = 0; i < valid.length; i++) {
          const payment = valid[i],
            gross = BigInt(payment.amount_paid!) * 10000n,
            portion = i === valid.length - 1 ? amount - allocated : (amount * gross) / cash;
          allocated += portion;
          await tx.query(
            'INSERT INTO billing_payments(payment_intent_id,organization_id,reference,cash_micro_usd,funded_micro_usd,credit_expires_at) VALUES($1,$2,$3,$4,$5,$6)',
            [
              ref(payment.payment.payment_intent),
              org,
              reference,
              gross.toString(),
              portion.toString(),
              expires,
            ],
          );
        }
      }
      await expireCredits(tx, org);
    });
    return;
  }
  if (event.type === 'charge.refunded' || event.type.startsWith('charge.dispute.')) {
    const dispute = event.type === 'charge.refunded' ? undefined : (event.data.object as Stripe.Dispute);
    const charge =
      event.type === 'charge.refunded'
        ? event.data.object
        : await provider.charges.retrieve(ref(dispute!.charge)!);
    const org = await organization(charge.customer),
      payment = ref(charge.payment_intent);
    if (!org || !payment) return;
    await once(org, event, async (tx) => {
      const receipt = (
        await tx.query('SELECT * FROM billing_payments WHERE payment_intent_id=$1 FOR UPDATE', [payment])
      ).rows[0];
      assert(
        receipt,
        503,
        'payment_receipt_pending',
        'Wait for the corresponding payment receipt before reconciling its reversal.',
      );
      const gross = BigInt(receipt.cash_micro_usd),
        funded = BigInt(receipt.funded_micro_usd);
      const refunded =
        BigInt(charge.amount_refunded) * 10000n > BigInt(receipt.refunded_micro_usd)
          ? BigInt(charge.amount_refunded) * 10000n
          : BigInt(receipt.refunded_micro_usd);
      const disputes = receipt.disputes as Record<
        string,
        { created: number; amount: string; status: string }
      >;
      if (dispute) {
        // Read under the organization lock: webhook timestamps have only second precision,
        // and a state fetched before acquiring the lock could overwrite a newer outcome.
        const current = await provider.disputes.retrieve(dispute.id);
        disputes[dispute.id] = {
          created: event.created,
          amount: (BigInt(current.amount) * 10000n).toString(),
          status: current.status,
        };
      }
      let cashReversed =
        refunded +
        Object.values(disputes)
          .filter((d) => !['won', 'warning_closed'].includes(d.status))
          .reduce((sum, d) => sum + BigInt(d.amount), 0n);
      if (cashReversed > gross) cashReversed = gross;
      // Round a fractional credit reversal upward by at most one micro-USD, capped at funded credit.
      const lot = (
        await tx.query('SELECT id,original_micro_usd FROM credit_lots WHERE reference=$1', [
          receipt.reference,
        ])
      ).rows[0];
      const expired = lot
        ? BigInt(
            (
              await tx.query(
                "SELECT COALESCE(sum(amount_micro_usd),0) AS amount FROM ledger WHERE account='expired_credits' AND reference LIKE $1",
                [`expiry:${lot.id}:%`],
              )
            ).rows[0].amount,
          )
        : 0n;
      const recoverable = funded - (lot ? (funded * expired) / BigInt(lot.original_micro_usd) : 0n);
      const raw = (funded * cashReversed + gross - 1n) / gross;
      const desired = raw < recoverable ? raw : recoverable,
        delta = desired - BigInt(receipt.reversed_micro_usd);
      const reference = `stripe:reversal:${event.id}:${payment}`;
      if (delta > 0n) await debit(tx, org, delta, reference, 'payment_reversals', receipt.reference);
      else if (delta < 0n) await credit(tx, org, -delta, reference, 'dispute_reinstatement');
      await tx.query(
        'UPDATE billing_payments SET refunded_micro_usd=$2,reversed_micro_usd=$3,disputes=$4 WHERE payment_intent_id=$1',
        [payment, refunded.toString(), desired.toString(), JSON.stringify(disputes)],
      );
      const open = await tx.query(
        "SELECT 1 FROM billing_payments p, jsonb_each(p.disputes) d WHERE d.value->>'status' NOT IN ('won','lost','warning_closed') LIMIT 1",
      );
      await tx.query('UPDATE organizations SET settings=settings||$2::jsonb WHERE id=$1', [
        org,
        JSON.stringify({ payment_dispute_hold: !!open.rowCount }),
      ]);
      if (open.rowCount)
        await tx.query(
          "UPDATE runs SET cancel_requested=true WHERE status IN ('queued','provisioning','running','waiting_for_input')",
        );
      await expireCredits(tx, org);
    });
    return;
  }
  await once(null, event, async () => {});
}
