import { apiSpec } from '@platform/core/http-contract';
import { config } from '@platform/core/config';
export function GET() {
  return Response.json(
    { ...apiSpec, servers: [{ url: config.origin }] },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
