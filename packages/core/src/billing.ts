import { planFor } from './plans';
import Stripe from 'stripe';
import type { Tx } from '../../db';
import type { Principal } from './auth';
import { assert } from './errors';
import { config } from './config';
import { v5 as stableId } from 'uuid';
import { boundedBody } from './body';
import { processStripeEvent } from './billing-events';
import type { components } from '../../contracts/api';
export function stripe() {
  assert(
    process.env.STRIPE_SECRET_KEY,
    503,
    'billing_not_configured',
    'The operator needs to configure Stripe before accepting payments.',
  );
  return new Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 15000, maxNetworkRetries: 1 });
}
export async function checkout(
  tx: Tx,
  p: Principal,
  input: components['schemas']['CheckoutCreate'],
  key: string,
  provider?: Pick<Stripe, 'customers' | 'checkout'>,
) {
  assert(p.role === 'owner', 403, 'forbidden', 'Only the organization owner can manage billing.');
  const plan = planFor(input.plan || 'pro');
  const priceId = process.env[`STRIPE_${plan.id.toUpperCase()}_PRICE_ID`];
  if (input.kind === 'subscription')
    assert(
      plan.id !== 'payg' && priceId,
      503,
      'billing_not_configured',
      'The subscription price is not configured.',
    );
  const org = (
    await tx.query('SELECT * FROM organizations WHERE id=$1 FOR NO KEY UPDATE', [p.organizationId])
  ).rows[0];
  const client = provider || stripe();
  let customer = org.settings.stripe_customer_id as string | undefined;
  if (!customer) {
    customer = (
      await client.customers.create(
        { email: p.email, name: org.name, metadata: { organization_id: p.organizationId } },
        { idempotencyKey: `customer:${p.organizationId}` },
      )
    ).id;
    await tx.query('UPDATE organizations SET settings=settings || $2::jsonb WHERE id=$1', [
      p.organizationId,
      JSON.stringify({ stripe_customer_id: customer }),
    ]);
  }
  const base = {
    customer,
    success_url: `${config.origin}/billing?checkout=success`,
    cancel_url: `${config.origin}/billing`,
    metadata: {
      organization_id: p.organizationId,
      kind: input.kind,
      order_id: stableId(`${p.organizationId}:${key}`, stableId.URL),
    },
    client_reference_id: p.organizationId,
  };
  const orderId = base.metadata.order_id;
  const existing = (await tx.query('SELECT checkout_url,status FROM billing_orders WHERE id=$1', [orderId]))
    .rows[0];
  if (existing?.checkout_url && existing.status === 'pending') return { url: existing.checkout_url };
  if (input.kind === 'subscription') {
    assert(
      org.plan === 'payg',
      409,
      'subscription_exists',
      'Manage your existing subscription in the billing portal.',
    );
    const pending = (
      await tx.query(
        "SELECT checkout_url,subscription_plan FROM billing_orders WHERE kind='subscription' AND status='pending' AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
      )
    ).rows[0];
    if (pending?.checkout_url) {
      assert(
        (pending.subscription_plan || 'pro') === plan.id,
        409,
        'checkout_pending',
        'A checkout for another plan is still open. Finish it and switch plans in the billing portal, or wait for that checkout to expire.',
      );
      return { url: pending.checkout_url };
    }
  }
  await tx.query(
    'INSERT INTO billing_orders(id,organization_id,request_key,kind,expected_micro_usd,customer_id,subscription_plan) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',
    [
      orderId,
      p.organizationId,
      key,
      input.kind,
      input.kind === 'topup' ? input.amount_micro_usd || '0' : '0',
      customer,
      input.kind === 'subscription' ? plan.id : null,
    ],
  );
  let session: Stripe.Checkout.Session;
  if (input.kind === 'topup') {
    const amount = BigInt(input.amount_micro_usd || '0');
    assert(
      amount >= 10000000n && amount <= 1000000000n && amount % 10000n === 0n,
      400,
      'invalid_amount',
      'Choose $10–$1,000 in whole cents.',
    );
    session = await client.checkout.sessions.create(
      {
        ...base,
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: Number(amount / 10000n),
              product_data: { name: 'Agent execution credits' },
            },
          },
        ],
        payment_intent_data: { metadata: base.metadata },
      },
      { idempotencyKey: `checkout:${p.organizationId}:${key}` },
    );
  } else {
    assert(priceId, 503, 'billing_not_configured', 'The subscription price has not been configured.');
    session = await client.checkout.sessions.create(
      {
        ...base,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { metadata: { organization_id: p.organizationId } },
      },
      { idempotencyKey: `checkout:${p.organizationId}:${key}` },
    );
  }
  assert(session.url, 502, 'checkout_failed', 'Stripe did not return a checkout link.');
  await tx.query('UPDATE billing_orders SET session_id=$2,checkout_url=$3,expires_at=$4 WHERE id=$1', [
    orderId,
    session.id,
    session.url,
    new Date(session.expires_at * 1000),
  ]);
  return { url: session.url };
}
export async function portal(tx: Tx, p: Principal) {
  assert(p.role === 'owner', 403, 'forbidden', 'Only the owner can manage billing.');
  const row = (await tx.query('SELECT settings FROM organizations WHERE id=$1', [p.organizationId])).rows[0];
  assert(
    row.settings.stripe_customer_id,
    409,
    'customer_missing',
    'Complete your first checkout before opening the billing portal.',
  );
  const session = await stripe().billingPortal.sessions.create({
    customer: row.settings.stripe_customer_id,
    return_url: `${config.origin}/billing`,
  });
  return { url: session.url };
}
export async function stripeWebhook(request: Request) {
  assert(
    process.env.STRIPE_WEBHOOK_SECRET,
    503,
    'billing_not_configured',
    'Stripe webhook signing secret is missing.',
  );
  const signature = request.headers.get('stripe-signature');
  assert(signature, 400, 'invalid_signature', 'Stripe signature is missing.');
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      await boundedBody(request.body, 1024 * 1024),
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    assert(false, 400, 'invalid_signature', 'Stripe signature is invalid.');
  }
  await processStripeEvent(event);
  return Response.json({ received: true });
}
