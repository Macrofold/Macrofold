import { afterEach, expect, it, vi } from 'vitest';
import { computeMaximum, computeRate } from '../../packages/core/src/catalog';

afterEach(() => vi.unstubAllEnvs());
it('rounds fractional compute liability upward using integer micro-USD', () => {
  expect(computeMaximum(1, '8000')).toBe(134n);
  expect(computeMaximum(60, '8000')).toBe(8000n);
  expect(computeMaximum(7200, '999999999999')).toBe(119999999999880n);
  expect(computeMaximum(0, '8000')).toBe(0n);
  expect(computeMaximum(60, '0')).toBe(0n);
});
it.each(['-1', '1.5', 'NaN', '1000000000000'])('rejects invalid operator compute rate %s', (rate) => {
  vi.stubEnv('COMPUTE_MICRO_USD_PER_MINUTE', rate);
  expect(() => computeRate()).toThrow(expect.objectContaining({ code: 'invalid_compute_rate' }));
});
