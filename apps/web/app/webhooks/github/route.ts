import { githubWebhook } from '@platform/core/github-webhooks';
import { errorBody } from '@platform/core/errors';
import { id } from '@platform/core/crypto';
export async function POST(request: Request) {
  try { return await githubWebhook(request); }
  catch (error) { const result = errorBody(error, id()); return Response.json(result.body, { status: result.status }); }
}
