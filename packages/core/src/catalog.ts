import { config, isLocal } from './config';
import { assert } from './errors';
export function computeRate() {
  if (isLocal() && config.execution === 'docker') return '0';
  const rate = process.env.COMPUTE_MICRO_USD_PER_MINUTE || '8000';
  assert(
    /^\d{1,12}$/.test(rate),
    503,
    'invalid_compute_rate',
    'The operator must configure a valid compute rate.',
  );
  return rate;
}
export function computeMaximum(timeoutSeconds: number, rate = computeRate()) {
  return (BigInt(timeoutSeconds) * BigInt(rate) + 59n) / 60n;
}
export { harnesses } from '../../contracts/harnesses';
export { models } from './model-catalog';
export type { Model } from './model-policy';
