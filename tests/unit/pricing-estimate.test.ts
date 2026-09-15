import { describe, expect, it } from 'vitest';
import { estimateMonthlyCost } from '../../apps/web/components/pricing/estimate';

const input = {
  hours: '100',
  modelSpend: '20',
  byok: false,
  plan: { monthlyMicro: '29000000', includedMicro: '10000000' },
  computeMicroPerMinute: '8000',
};

describe('public monthly cost estimate', () => {
  it('adds the subscription to net usage, rather than turning the whole fee into credits', () => {
    expect(estimateMonthlyCost(input)).toEqual({
      subscription: 29_000_000n,
      compute: 48_000_000n,
      models: 20_000_000n,
      credit: 10_000_000n,
      platform: 87_000_000n,
      provider: 0n,
      total: 87_000_000n,
    });
  });
  it('does not use platform credits to pay the separate BYOK provider bill', () => {
    expect(estimateMonthlyCost({ ...input, hours: '1', byok: true })).toMatchObject({
      compute: 480_000n,
      credit: 480_000n,
      platform: 29_000_000n,
      provider: 20_000_000n,
      total: 49_000_000n,
    });
    expect(estimateMonthlyCost({ ...input, hours: '1' })!.total).toBe(39_480_000n);
  });
  it('caps applied credits at actual usage without refunding unused allowance', () => {
    expect(estimateMonthlyCost({ ...input, hours: '0', modelSpend: '0' })).toMatchObject({
      credit: 0n,
      platform: 29_000_000n,
      total: 29_000_000n,
    });
    expect(estimateMonthlyCost({ ...input, hours: '0', modelSpend: '5' })).toMatchObject({
      credit: 5_000_000n,
      total: 29_000_000n,
    });
  });
  it('uses the supplied rate and preserves fractional hours and cents without floating-point drift', () => {
    expect(
      estimateMonthlyCost({
        ...input,
        hours: '0.01',
        modelSpend: '0.10',
        computeMicroPerMinute: '12345',
        plan: { monthlyMicro: '0', includedMicro: '0' },
      }),
    ).toMatchObject({ compute: 7_407n, models: 100_000n, total: 107_407n });
    expect(estimateMonthlyCost({ ...input, computeMicroPerMinute: '0' })!.compute).toBe(0n);
  });
  it.each(['', '-1', 'NaN', 'Infinity', '1e4', '2.001', '1000000.01', '1,000'])(
    'rejects invalid input %s instead of displaying a free or stale estimate',
    (value) => {
      expect(estimateMonthlyCost({ ...input, hours: value })).toBeNull();
      expect(estimateMonthlyCost({ ...input, modelSpend: value })).toBeNull();
    },
  );
  it('keeps the maximum supported input exact', () => {
    expect(estimateMonthlyCost({ ...input, hours: '1000000', modelSpend: '1000000' })!.total).toBe(
      1_480_019_000_000n,
    );
  });
});
