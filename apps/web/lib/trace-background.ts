import { waitUntil } from '@vercel/functions';
import { flushTraces, traceDiagnostic, tracingEnabled } from '@platform/core/tracing';
import { initializePerformance } from '@platform/core/performance-composition';
import { flushPerformance, performanceEnabled } from '@platform/core/performance';

/** Workflow bundles its steps independently of Next's request async storage.
 * Use the same host lifecycle primitive as Workflow itself: keep export alive,
 * but publish the step result without waiting for network delivery. On a local
 * long-lived worker the SDK timer/shutdown remains the lifecycle owner. */
export function flushTracesInBackground() {
  initializePerformance();
  if (!tracingEnabled() && !performanceEnabled()) return;
  try {
    waitUntil(Promise.allSettled([flushTraces(), flushPerformance()]));
  } catch {
    traceDiagnostic('trace_flush_schedule_failed');
  }
}
