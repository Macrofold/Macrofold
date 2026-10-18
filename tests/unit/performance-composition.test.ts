import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('PERF_PROFILING_ENABLED', 'false');
  vi.stubEnv('PERF_PROFILING_SAMPLE_RATE', '1');
  vi.stubEnv('PERF_PROFILING_DURATION_SECONDS', '1');
  vi.stubEnv('PERF_PROFILING_OUTPUT_DIR', '');
});
afterEach(async () => {
  const { shutdownPerformance } = await import('../../packages/core/src/performance');
  await shutdownPerformance();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('keeps ordinary startup free of pool wrappers, profiling clocks and timers', async () => {
  const { pool, authPool, credentialPool } = await import('../../packages/db');
  const { initializePerformance } = await import('../../packages/core/src/performance-composition');
  const { performanceEnabled, runPerformanceRoot } = await import('../../packages/core/src/performance');
  const pools = [pool, authPool, credentialPool];
  const originals = pools.map((entry) => entry.connect);
  const interval = vi.spyOn(globalThis, 'setInterval');
  const timeout = vi.spyOn(globalThis, 'setTimeout');
  const clock = vi.spyOn(performance, 'now');
  initializePerformance();
  initializePerformance();
  const result = Promise.resolve('ordinary application result');
  expect(runPerformanceRoot('rest', {}, () => result)).toBe(result);
  expect(performanceEnabled()).toBe(false);
  expect(pools.map((entry) => entry.connect)).toEqual(originals);
  expect(interval).not.toHaveBeenCalled();
  expect(timeout).not.toHaveBeenCalled();
  expect(clock).not.toHaveBeenCalled();
});

it('fails open for invalid optional startup flags using only a fixed safe warning', async () => {
  vi.stubEnv('PERF_PROFILING_ENABLED', 'invalid-sensitive-configuration');
  const { pool, authPool, credentialPool } = await import('../../packages/db');
  const { initializePerformance } = await import('../../packages/core/src/performance-composition');
  const { performanceEnabled, runPerformanceRoot } = await import('../../packages/core/src/performance');
  const pools = [pool, authPool, credentialPool];
  const originals = pools.map((entry) => entry.connect);
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(() => initializePerformance()).not.toThrow();
  expect(runPerformanceRoot('rest', {}, () => 'application continues')).toBe('application continues');
  expect(performanceEnabled()).toBe(false);
  expect(pools.map((entry) => entry.connect)).toEqual(originals);
  expect(warning).toHaveBeenCalledExactlyOnceWith('{"code":"performance_profile_configuration_invalid"}');
});

it('disables startup profiling and restores pool methods when a private output directory is rejected', async () => {
  const directory = await mkdtemp(path.join(await realpath(tmpdir()), 'profile-invalid-directory-'));
  try {
    await chmod(directory, 0o755);
    vi.stubEnv('PLATFORM_MODE', 'local');
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3210');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('PERF_PROFILING_ENABLED', 'true');
    vi.stubEnv('PERF_PROFILING_DURATION_SECONDS', '300');
    vi.stubEnv('PERF_PROFILING_OUTPUT_DIR', directory);
    const { pool, authPool, credentialPool } = await import('../../packages/db');
    const { initializePerformance } = await import('../../packages/core/src/performance-composition');
    const { performanceEnabled, shutdownPerformance } = await import('../../packages/core/src/performance');
    const pools = [pool, authPool, credentialPool];
    const originals = pools.map((entry) => entry.connect);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    initializePerformance();
    expect(performanceEnabled()).toBe(true);
    for (const [index, entry] of pools.entries()) expect(entry.connect).not.toBe(originals[index]);
    await expect.poll(() => performanceEnabled()).toBe(false);
    expect(pools.map((entry) => entry.connect)).toEqual(originals);
    expect(warning).toHaveBeenCalledWith('{"code":"performance_profile_configuration_invalid"}');
    expect(JSON.stringify(warning.mock.calls)).not.toContain(directory);
    await shutdownPerformance();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('automatically restores owned pool methods when the startup capture window expires', async () => {
  vi.stubEnv('PERF_PROFILING_ENABLED', 'true');
  const { pool, authPool, credentialPool } = await import('../../packages/db');
  const { initializePerformance } = await import('../../packages/core/src/performance-composition');
  const { performanceEnabled, shutdownPerformance } = await import('../../packages/core/src/performance');
  const pools = [pool, authPool, credentialPool];
  const originals = pools.map((entry) => entry.connect);
  vi.useFakeTimers();
  initializePerformance();
  expect(performanceEnabled()).toBe(true);
  for (const [index, entry] of pools.entries()) expect(entry.connect).not.toBe(originals[index]);
  const installed = pools.map((entry) => entry.connect);
  // Readiness and transport entry points reuse the same composition instance.
  initializePerformance();
  expect(pools.map((entry) => entry.connect)).toEqual(installed);
  await vi.advanceTimersByTimeAsync(1000);
  await shutdownPerformance();
  expect(performanceEnabled()).toBe(false);
  expect(pools.map((entry) => entry.connect)).toEqual(originals);
  await vi.runOnlyPendingTimersAsync();
  expect(vi.getTimerCount()).toBe(0);
});
