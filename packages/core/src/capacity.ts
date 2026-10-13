import { AppError } from './errors';

/** Deployment resource budgets, never customer spending authority. No silent
 * clamps: a typo must not quietly turn a production deployment into one slot. */
export function capacitySetting(name: string, fallback: number, maximum = 100_000, minimum = 1) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new AppError(
      503,
      'invalid_capacity_configuration',
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  return value;
}

export const dispatchClasses = ['inference', 'provision', 'transfer', 'control'] as const;
export type DispatchClass = (typeof dispatchClasses)[number];
export type DispatchLimits = Record<DispatchClass, number>;
export function dispatchLimits(): DispatchLimits {
  return {
    inference: capacitySetting('DISPATCH_INFERENCE_CONCURRENCY', 64, 1024),
    provision: capacitySetting('DISPATCH_PROVISION_CONCURRENCY', 16, 256),
    transfer: capacitySetting('DISPATCH_TRANSFER_CONCURRENCY', 8, 256),
    control: capacitySetting('DISPATCH_CONTROL_CONCURRENCY', 64, 1024),
  };
}
export function fleetLimits() {
  const native = capacitySetting('NATIVE_CONCURRENT_RUN_LIMIT', 200);
  const inference = capacitySetting('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', 2000);
  return {
    native,
    inference,
    total: capacitySetting('GLOBAL_CONCURRENT_RUN_LIMIT', native + inference, 200_000),
  };
}
