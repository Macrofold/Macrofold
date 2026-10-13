import { afterEach, expect, it, vi } from 'vitest';
import { capacitySetting, dispatchLimits, fleetLimits } from '../../packages/core/src/capacity';
import { requestCapacity } from '../../packages/core/src/request-capacity';
import { mapConcurrent } from '../../packages/core/src/concurrent';

afterEach(() => vi.unstubAllEnvs());
it('configures independent resources without silently clamping to twenty', () => {
  vi.stubEnv('DISPATCH_INFERENCE_CONCURRENCY', '128');
  vi.stubEnv('DISPATCH_TRANSFER_CONCURRENCY', '2');
  expect(dispatchLimits()).toMatchObject({ inference: 128, transfer: 2 });
  vi.stubEnv('NATIVE_CONCURRENT_RUN_LIMIT', '200');
  vi.stubEnv('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', '2000');
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', '2200');
  expect(fleetLimits()).toEqual({ native: 200, inference: 2000, total: 2200 });
});
it('allows the aggregate fleet budget to cover both independently configured fleets', () => {
  vi.stubEnv('NATIVE_CONCURRENT_RUN_LIMIT', '100000');
  vi.stubEnv('LIGHTWEIGHT_CONCURRENT_RUN_LIMIT', '100000');
  vi.stubEnv('GLOBAL_CONCURRENT_RUN_LIMIT', undefined);
  expect(fleetLimits().total).toBe(200000);
});
it.each(['', '0', '-1', '1.5', 'Infinity', 'typo', '100001'])(
  'rejects invalid deployment capacity %j',
  (value) => {
    vi.stubEnv('TEST_RESOURCE_CAPACITY', value);
    expect(() => capacitySetting('TEST_RESOURCE_CAPACITY', 64)).toThrow(
      expect.objectContaining({ code: 'invalid_capacity_configuration' }),
    );
  },
);
it('keeps read, submission and cancellation buckets distinct', () => {
  vi.stubEnv('API_READ_RATE_LIMIT_PER_MINUTE', '6000');
  vi.stubEnv('API_WRITE_RATE_LIMIT_PER_MINUTE', '1200');
  vi.stubEnv('API_CONTROL_RATE_LIMIT_PER_MINUTE', '600');
  expect(requestCapacity('GET', 'getRun')).toEqual({ group: 'read', limit: 6000 });
  expect(requestCapacity('POST', 'createInference')).toEqual({ group: 'write', limit: 1200 });
  expect(requestCapacity('POST', 'cancelRun')).toEqual({ group: 'control', limit: 600 });
  expect(requestCapacity('POST', 'submitRunInput').group).toBe('control');
});
it('refills a free I/O slot while another operation remains blocked', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: number[] = [];
  let active = 0,
    peak = 0;
  const work = mapConcurrent([0, 1, 2, 3], 2, async (value) => {
    started.push(value);
    peak = Math.max(peak, ++active);
    if (value === 0) await gate;
    active--;
    return value;
  });
  try {
    await vi.waitFor(() => expect(started).toEqual([0, 1, 2, 3]));
    expect(active).toBe(1);
  } finally {
    release();
  }
  expect(await work).toEqual([0, 1, 2, 3]);
  expect(peak).toBe(2);
});
it('stops taking new I/O and drains existing work before exposing an error', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const call = vi.fn(async (value: number) => {
    if (!value) throw Error('fixture');
    await gate;
    return value;
  });
  let settled = false;
  const result = mapConcurrent([0, 1, 2, 3], 2, call).finally(() => {
    settled = true;
  });
  const rejected = expect(result).rejects.toThrow('fixture');
  try {
    await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
  } finally {
    release();
  }
  await rejected;
  expect(call).toHaveBeenCalledTimes(2);
});
