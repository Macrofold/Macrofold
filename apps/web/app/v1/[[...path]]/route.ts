import { handleRestApi } from '../../../lib/rest-api';
import { healthResponse } from '../../../lib/health';
export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ path?: string[] }> };
async function route(request: Request, context: Context) {
  // Rewrites preserve the original request URL; matched parameters identify the
  // operational path. Keep health outside API authority and background work.
  const { path } = await context.params;
  if (path?.length === 1 && path[0] === '_health') {
    if (request.method === 'GET') return healthResponse();
    if (request.method === 'HEAD') {
      const response = await healthResponse();
      return new Response(null, { status: response.status, headers: response.headers });
    }
    return new Response(null, {
      status: request.method === 'OPTIONS' ? 204 : 405,
      headers: { Allow: 'GET, HEAD, OPTIONS' },
    });
  }
  // Preserve Next's automatic OPTIONS response now that health needs its own.
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: { Allow: 'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT' },
    });
  const hostDeadlineAtMs = Date.now() + maxDuration * 1000;
  return handleRestApi(request, hostDeadlineAtMs);
}
export const GET = route,
  POST = route,
  PUT = route,
  PATCH = route,
  DELETE = route,
  HEAD = route,
  OPTIONS = route;
