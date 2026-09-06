import type { Tx } from '../../db';
import { assert } from './errors';

export const QUEUE_TIMEOUT_SECONDS = 86400;
export const planIds = ['payg', 'pro', 'scale'] as const;
export type PlanId = (typeof planIds)[number];

/** Subscription fees buy limits and included credit; execution is still metered.
 * Keep the payg identifier stable for existing accounts and API clients. */
export function plans() {
  return [
    {
      id: 'payg',
      name: 'Starter',
      monthly_price_micro_usd: '0',
      included_credit_micro_usd: '0',
      concurrency_limit: 2,
      max_timeout_seconds: 1800,
      scheduler_weight: 1,
      storage_gib: 1,
      history_days: 30,
    },
    {
      id: 'pro',
      name: 'Pro',
      monthly_price_micro_usd: process.env.PRO_MONTHLY_PRICE_MICRO_USD || '29000000',
      included_credit_micro_usd: process.env.PRO_INCLUDED_CREDIT_MICRO_USD || '10000000',
      concurrency_limit: 10,
      max_timeout_seconds: 3600,
      scheduler_weight: 2,
      storage_gib: 10,
      history_days: 90,
    },
    {
      id: 'scale',
      name: 'Scale',
      monthly_price_micro_usd: process.env.SCALE_MONTHLY_PRICE_MICRO_USD || '199000000',
      included_credit_micro_usd: process.env.SCALE_INCLUDED_CREDIT_MICRO_USD || '50000000',
      concurrency_limit: 50,
      max_timeout_seconds: 7200,
      scheduler_weight: 4,
      storage_gib: 50,
      history_days: 90,
    },
  ] as const;
}
export function planFor(id: string) {
  const plan = plans().find((value) => value.id === id);
  assert(plan, 503, 'unknown_plan', 'The account plan needs operator review.');
  return plan;
}
export function subscriptionPlan(priceId?: string) {
  return plans().find(
    (p) => p.id !== 'payg' && priceId && priceId === process.env[`STRIPE_${p.id.toUpperCase()}_PRICE_ID`],
  );
}
export function executionPolicy(row: {
  plan: string;
  run_concurrency_limit: number | null;
  run_timeout_seconds: number | null;
}) {
  const plan = planFor(row.plan);
  return {
    plan: plan.id,
    plan_name: plan.name,
    concurrency_limit: Math.min(row.run_concurrency_limit ?? plan.concurrency_limit, plan.concurrency_limit),
    max_timeout_seconds: Math.min(
      row.run_timeout_seconds ?? plan.max_timeout_seconds,
      plan.max_timeout_seconds,
    ),
    concurrency_override: row.run_concurrency_limit,
    timeout_override_seconds: row.run_timeout_seconds,
    plan_concurrency_limit: plan.concurrency_limit,
    plan_max_timeout_seconds: plan.max_timeout_seconds,
    default_queue_timeout_seconds: QUEUE_TIMEOUT_SECONDS,
  };
}
export async function getExecutionPolicy(tx: Tx, org: string) {
  const row = (
    await tx.query('SELECT plan,run_concurrency_limit,run_timeout_seconds FROM organizations WHERE id=$1', [
      org,
    ])
  ).rows[0];
  return executionPolicy(row);
}
