import { handleApi, initializeApi } from '@platform/core/http';
import { initializeTracing } from '@platform/core/tracing';
import { initializePerformance } from '@platform/core/performance-composition';
import { after } from 'next/server';
import { dispatchRuns } from './dispatch';
import { scheduleTraceFlush } from './trace-flush';

/** Readiness loads the same host composition as REST, without invoking a request
 * or registering any background work. Vercel's separate functions skip this. */
export function initializeRestApi() {
  // Next instrumentation can compile a separate collector around the same
  // global pools. Keep profiling in the graph that owns request attribution.
  initializePerformance();
  initializeApi();
  initializeTracing();
}

export function handleRestApi(request: Request, hostDeadlineAtMs: number) {
  scheduleTraceFlush();
  return handleApi(request, 'rest', (task) => after(task), {
    hostDeadlineAtMs,
    onMutation: () => after(dispatchRuns),
  });
}
