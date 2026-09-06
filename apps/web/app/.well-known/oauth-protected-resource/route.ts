import { config } from '@platform/core/config';
import { customerScopes } from '@platform/core/auth';
export function GET() {
  return Response.json({
    resource: `${config.origin}/v1`,
    authorization_servers: [`${config.origin}/auth`],
    scopes_supported: customerScopes,
    bearer_methods_supported: ['header'],
  });
}
