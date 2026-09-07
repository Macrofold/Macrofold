import type { Tx } from '../../packages/db';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  executionPolicy,
  subscriptionPlan,
  planFor,
  getExecutionPolicy,
} from '../../packages/core/src/plans';

afterEach(() => vi.unstubAllEnvs());
describe('plan limits cannot be raised by an account override', () => {
  it.each([
    ['payg', 2, 1800],
    ['pro', 10, 3600],
    ['scale', 50, 7200],
  ] as const)('%s caps override and default independently', (plan, concurrency, timeout) => {
    const defaults = executionPolicy({ plan, run_concurrency_limit: null, run_timeout_seconds: null });
    expect(defaults).toMatchObject({
      plan,
      concurrency_limit: concurrency,
      max_timeout_seconds: timeout,
      default_queue_timeout_seconds: 86400,
    });
    expect(
      executionPolicy({ plan, run_concurrency_limit: concurrency + 1, run_timeout_seconds: timeout + 1 }),
    ).toMatchObject({ concurrency_limit: concurrency, max_timeout_seconds: timeout });
    expect(executionPolicy({ plan, run_concurrency_limit: 1, run_timeout_seconds: 60 })).toMatchObject({
      concurrency_limit: 1,
      max_timeout_seconds: 60,
      concurrency_override: 1,
      timeout_override_seconds: 60,
    });
  });
  it('rejects unknown plans instead of silently assigning a permissive policy', () => {
    expect(() => planFor('enterprise-missing')).toThrow(
      expect.objectContaining({ code: 'unknown_plan', status: 503 }),
    );
  });
  it('maps only configured paid price IDs, including the second tier', () => {
    vi.stubEnv('STRIPE_PAYG_PRICE_ID', 'price_starter');
    expect(subscriptionPlan('price_starter')).toBeUndefined();
    vi.stubEnv('STRIPE_PRO_PRICE_ID', 'price_pro');
    vi.stubEnv('STRIPE_SCALE_PRICE_ID', 'price_scale');
    expect(subscriptionPlan('price_pro')?.id).toBe('pro');
    expect(subscriptionPlan('price_scale')?.id).toBe('scale');
    expect(subscriptionPlan('price_old')).toBeUndefined();
    expect(subscriptionPlan()).toBeUndefined();
    expect(subscriptionPlan('')).toBeUndefined();
  });
});

it('loads the selected organization policy through the supplied transaction', async () => {
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    expect(sql).toContain('FROM organizations');
    expect(values).toEqual(['organization-a']);
    return { rows: [{ plan: 'pro', run_concurrency_limit: 3, run_timeout_seconds: 120 }] };
  });
  expect(await getExecutionPolicy({ query } as unknown as Tx, 'organization-a')).toMatchObject({
    concurrency_limit: 3,
    max_timeout_seconds: 120,
    plan: 'pro',
  });
  expect(query).toHaveBeenCalledOnce();
});
