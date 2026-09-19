import { handleApi } from '@platform/core/http';
export const runtime = 'nodejs';
export const GET = (request: Request) => handleApi(request);
