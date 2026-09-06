import { handleApi } from '@platform/core/http';
import { after } from 'next/server';
import { dispatchRuns } from '@/lib/dispatch';
export const runtime = 'nodejs';
export const maxDuration = 300;
async function route(request: Request) {
  const response = await handleApi(request);
  if (request.method !== 'GET' && response.ok) after(dispatchRuns);
  return response;
}
export const GET = route,
  POST = route,
  PUT = route,
  PATCH = route,
  DELETE = route;
