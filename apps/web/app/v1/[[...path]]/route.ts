import { handleApi } from '@platform/core/http';
import { after } from 'next/server';
import { dispatchRuns } from '@/lib/dispatch';
import { scheduleTraceFlush } from '@/lib/trace-flush';
export const runtime = 'nodejs';
export const maxDuration = 300;
async function route(request: Request) {
  scheduleTraceFlush();
  const response = await handleApi(request, 'rest', (task) => after(task));
  if (request.method !== 'GET' && response.ok) after(dispatchRuns);
  return response;
}
export const GET = route,
  POST = route,
  PUT = route,
  PATCH = route,
  DELETE = route;
