import { stripeWebhook } from '@platform/core/billing';
import { errorBody } from '@platform/core/errors';
import { id } from '@platform/core/crypto';
export async function POST(request: Request) {
  try {
    return await stripeWebhook(request);
  } catch (error) {
    const result = errorBody(error, id());
    return Response.json(result.body, { status: result.status });
  }
}
