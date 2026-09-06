import { serveObject } from '@platform/core/transfers';
import { errorBody } from '@platform/core/errors';
import { id } from '@platform/core/crypto';
export const runtime = 'nodejs';
async function handle(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    return await serveObject(request, (await params).token);
  } catch (error) {
    const response = errorBody(error, id());
    return Response.json(response.body, { status: response.status });
  }
}
export const GET = handle,
  PUT = handle;
