import { publicConnectors } from '../../../../lib/docs/connectors';
export const dynamic = 'force-static';
export function GET() {
  return Response.json(publicConnectors, {
    headers: { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'public, max-age=3600' },
  });
}
