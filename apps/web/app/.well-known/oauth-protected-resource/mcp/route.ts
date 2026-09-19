import { config } from '@platform/core/config';
import { customerScopes } from '@platform/core/auth';
export function GET() {
  return Response.json({
    resource: `${config.origin}/mcp`,
    authorization_servers: [`${config.origin}/auth`],
    scopes_supported: customerScopes,
    bearer_methods_supported: ['header'],
    resource_documentation: `${config.origin}/docs/mcp`,
  });
}
