import { auth } from '@platform/core/auth';
import { toNextJsHandler } from 'better-auth/next-js';
import { assertSecurityConfiguration } from '@platform/core/config';
import { errorBody } from '@platform/core/errors';
const handlers = toNextJsHandler(auth);
async function handle(request: Request) {
  try {
    assertSecurityConfiguration();
    return await (request.method === 'GET' ? handlers.GET(request) : handlers.POST(request));
  } catch (error) {
    const result = errorBody(error, crypto.randomUUID());
    return Response.json(result.body, { status: result.status });
  }
}
export const GET = handle,
  POST = handle;
