import { config } from '@platform/core/config';
import { operatorScopes } from '@platform/core/auth';
export function GET() {
  return Response.json({
    resource: `${config.origin}/admin/mcp`,
    authorization_servers: [`${config.origin}/auth`],
    scopes_supported: operatorScopes,
    bearer_methods_supported: ['header'],
  });
}
