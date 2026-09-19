import { waitUntil } from '@vercel/functions';
import { flushTraces, traceDiagnostic, tracingEnabled } from '@platform/core/tracing';

/** Workflow bundles its steps independently of Next's request async storage.
 * Use the same host lifecycle primitive as Workflow itself: keep export alive,
 * but publish the step result without waiting for network delivery. On a local
 * long-lived worker the SDK timer/shutdown remains the lifecycle owner. */
export function flushTracesInBackground() {
  if (!tracingEnabled()) return;
  try {
    waitUntil(flushTraces());
  } catch {
    traceDiagnostic('trace_flush_schedule_failed');
  }
}
