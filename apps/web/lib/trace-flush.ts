import { after } from 'next/server';
import { flushTraces, traceDiagnostic, tracingEnabled } from '@platform/core/tracing';
import { initializePerformance } from '@platform/core/performance-composition';
import { flushPerformance, performanceEnabled } from '@platform/core/performance';

/** Register before streaming starts; Next keeps this task alive after the entire
 * response, including model streams. No exporter latency on the response path. */
export function scheduleTraceFlush() {
  initializePerformance();
  if (!tracingEnabled() && !performanceEnabled()) return;
  try {
    after(async () => {
      await Promise.allSettled([flushTraces(), flushPerformance()]);
    });
  } catch {
    // Outside a Next request the SDK's periodic batch export remains active.
    traceDiagnostic('trace_flush_schedule_failed');
  }
}
