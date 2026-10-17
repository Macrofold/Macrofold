import { channel } from 'node:diagnostics_channel';

const timings = channel('macrofold.inference.timing');
const noop = () => {};

/** Opt-in, content-free profiling. Ordinary requests retain no timing entries
 * or exporter work; subscribers belong to an explicitly configured profiler. */
export function startInferenceTiming(stage: string, enabled = true) {
  if (!enabled || !timings.hasSubscribers) return noop;
  const started = performance.now();
  return () => timings.publish({ stage, durationMs: performance.now() - started });
}
