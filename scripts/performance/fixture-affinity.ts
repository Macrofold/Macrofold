import { readFileSync } from 'node:fs';

/** Fixture-only: reject unsupported pinning instead of silently measuring a
 * different topology. Application/worker affinity is never changed here. */
export function fixturePeerCpus(value = process.env.PROFILE_INFERENCE_PEER_CPUS) {
  if (value === undefined) return;
  if (process.platform !== 'linux' || value.length > 128 || !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value))
    throw new Error('PROFILE_INFERENCE_PEER_CPUS requires Linux and a taskset CPU list.');
  return value;
}

export function fixtureCpuAffinity() {
  if (process.platform !== 'linux') return null;
  return readFileSync('/proc/self/status', 'utf8').match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1] ?? null;
}
