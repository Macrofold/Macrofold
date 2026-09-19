import { after } from 'next/server';
import { flushTraces, traceDiagnostic, tracingEnabled } from '@platform/core/tracing';

/** Register before streaming starts; Next keeps this task alive after the entire
 * response, including model streams. No exporter latency on the response path. */
export function scheduleTraceFlush() {
  if (!tracingEnabled()) return;
  try {
    after(flushTraces);
  } catch {
    // Outside a Next request the SDK's periodic batch export remains active.
    traceDiagnostic('trace_flush_schedule_failed');
  }
}
