import { assert } from './errors';
import type { ComputePrice, ResourceAllocation } from './worker-types';
const MICRO_USD = 1_000_000n;
const HOUR_MS = 3_600_000n;
const MIB_PER_GIB = 1024n;

export function workerUsdToMicro(value: string): bigint {
  assert(typeof value === 'string' && /^(0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(value),
    400, 'invalid_worker_cost', 'Use a nonnegative USD string with at most six fractional digits.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * MICRO_USD + BigInt(fraction.padEnd(6, '0'));
}
export function workerMicroBudget(value: string): bigint {
  assert(typeof value === 'string' && /^(0|[1-9]\d{0,14})$/.test(value),
    400, 'invalid_worker_cost', 'Use a nonnegative integer micro-USD string of at most 15 digits.');
  return BigInt(value);
}
export function workerMicroToUsd(value: bigint): string {
  assert(value >= 0n, 500, 'invalid_compute_meter', 'Compute cost cannot be negative.');
  return `${value / MICRO_USD}.${(value % MICRO_USD).toString().padStart(6, '0')}`;
}
function nonnegativeInteger(value: string): bigint {
  assert(typeof value === 'string' && /^(0|[1-9]\d{0,29})$/.test(value),
    500, 'invalid_compute_meter', 'Prices and cumulative meters must be nonnegative integer strings.');
  return BigInt(value);
}
export function validateWorkerResources(resources: ResourceAllocation): void {
  assert(Number.isSafeInteger(resources.memory_mib) && resources.memory_mib > 0 &&
    Number.isSafeInteger(resources.cpu_millis) && resources.cpu_millis > 0,
    400, 'invalid_worker_resources', 'Memory and CPU must be positive integers in MiB and millicores.');
}
function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
/** Reserve the peak allocation rate even when measured active CPU will cost less. */
export function workerHourlyExposure(price: ComputePrice, resources: ResourceAllocation): bigint {
  validateWorkerResources(resources);
  if (price.kind === 'allocation') return nonnegativeInteger(price.hourly_micro_usd);
  return ceilDivide(
    BigInt(resources.cpu_millis) * MIB_PER_GIB * nonnegativeInteger(price.cpu_hour_micro_usd) +
      BigInt(resources.memory_mib) * 1000n * nonnegativeInteger(price.gib_hour_micro_usd),
    1000n * MIB_PER_GIB,
  );
}
export type AllocationMeters = Readonly<{ kind: 'allocation'; elapsed_ms: string }>;
export type ResourceMeters = Readonly<{ kind: 'resource'; cpu_ms: string; memory_mib_ms: string }>;
export type ComputeMeters = AllocationMeters | ResourceMeters;

/** Cumulative rounding makes the bill independent of reporting frequency. */
export function workerAccruedCost(price: ComputePrice, meters: ComputeMeters): bigint {
  if (price.kind === 'allocation' && meters.kind === 'allocation')
    return ceilDivide(nonnegativeInteger(price.hourly_micro_usd) * nonnegativeInteger(meters.elapsed_ms), HOUR_MS);
  assert(price.kind === 'resource' && meters.kind === 'resource',
    500, 'compute_meter_kind_mismatch', 'The meter must match the accepted price.');
  return ceilDivide(
    nonnegativeInteger(meters.cpu_ms) * MIB_PER_GIB * nonnegativeInteger(price.cpu_hour_micro_usd) +
      nonnegativeInteger(meters.memory_mib_ms) * nonnegativeInteger(price.gib_hour_micro_usd),
    HOUR_MS * MIB_PER_GIB,
  );
}
export function workerChargeDelta(price: ComputePrice, previous: ComputeMeters, current: ComputeMeters): bigint {
  if (previous.kind === 'allocation' && current.kind === 'allocation') {
    assert(nonnegativeInteger(current.elapsed_ms) >= nonnegativeInteger(previous.elapsed_ms),
      409, 'compute_meter_regressed', 'A cumulative allocation meter cannot move backward.');
  } else {
    assert(previous.kind === 'resource' && current.kind === 'resource',
      409, 'compute_meter_kind_mismatch', 'Do not change meter type within a billing epoch.');
    assert(nonnegativeInteger(current.cpu_ms) >= nonnegativeInteger(previous.cpu_ms) &&
      nonnegativeInteger(current.memory_mib_ms) >= nonnegativeInteger(previous.memory_mib_ms),
      409, 'compute_meter_regressed', 'Cumulative resource meters cannot move backward.');
  }
  return workerAccruedCost(price, current) - workerAccruedCost(price, previous);
}
