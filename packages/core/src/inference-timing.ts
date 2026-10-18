import { channel } from 'node:diagnostics_channel';
import { startPerformanceStage } from './performance';
import type { PerformanceStage } from '../../contracts/performance';

const timings = channel('macrofold.inference.timing');
const noop = () => {};

/** Opt-in, content-free profiling. Ordinary requests retain no timing entries
 * or exporter work; subscribers belong to an explicitly configured profiler. */
export function startInferenceTiming(stage: PerformanceStage, enabled = true) {
  if (!enabled) return noop;
  const stop = startPerformanceStage(stage);
  if (!timings.hasSubscribers) return stop;
  const started = performance.now();
  return () => {
    stop();
    timings.publish({ stage, durationMs: performance.now() - started });
  };
}
