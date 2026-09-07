import { afterEach, expect, it, vi } from 'vitest';
import { assertBudget, safeError } from '../../scripts/live/guard';

afterEach(() => vi.unstubAllEnvs());
const attempt = {
  platform: 'openai' as const,
  operation: 'fixture',
  at: 'fixture',
  ceilingMicroUsd: 900_000,
};
it('keeps uncertain attempts reserved across retries and separates platform caps', () => {
  expect(() => assertBudget([attempt], 'openai', 100_000)).not.toThrow();
  expect(() => assertBudget([attempt], 'openai', 100_001)).toThrow('budget exhausted');
  expect(() => assertBudget([attempt], 'anthropic', 1_000_000)).not.toThrow();
});
it('bounds free metadata retries as well as paid requests', () => {
  expect(() => assertBudget(Array(40).fill({ ...attempt, ceilingMicroUsd: 0 }), 'openai', 0)).toThrow(
    'budget exhausted',
  );
});
it.each([-1, 0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  'rejects invalid ceilings (%s)',
  (value) => {
    expect(() => assertBudget([], 'openai', value)).toThrow('Invalid');
    expect(() => assertBudget([{ ...attempt, ceilingMicroUsd: value }], 'openai', 0)).toThrow('Invalid');
  },
);
it('redacts configured secrets and signed URLs from failure reports', () => {
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'synthetic-private-secret');
  const error = safeError(
    new Error('Rejected synthetic-private-secret at https://fixture.invalid/object?signature=private'),
  );
  expect(error.message).toBe('Rejected [redacted] at [url]');
});
