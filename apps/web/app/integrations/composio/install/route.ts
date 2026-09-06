import { startComposio } from '@platform/core/composio-auth';
import { errorBody } from '@platform/core/errors';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    return await startComposio(request);
  } catch (e) {
    const error = errorBody(e, crypto.randomUUID());
    return Response.json(error.body, {
      status: error.status,
      headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    });
  }
}
