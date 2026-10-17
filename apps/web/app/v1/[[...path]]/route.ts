import { handleApi } from '@platform/core/http';
import { after } from 'next/server';
import { dispatchRuns } from '@/lib/dispatch';
import { scheduleTraceFlush } from '@/lib/trace-flush';
export const runtime = 'nodejs';
export const maxDuration = 300;
async function route(request: Request) {
  const hostDeadlineAtMs = Date.now() + maxDuration * 1000;
  scheduleTraceFlush();
  return handleApi(request, 'rest', (task) => after(task), {
    hostDeadlineAtMs,
    onMutation: () => after(dispatchRuns),
  });
}
export const GET = route,
  POST = route,
  PUT = route,
  PATCH = route,
  DELETE = route;
