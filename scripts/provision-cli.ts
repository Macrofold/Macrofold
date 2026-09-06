import pg from 'pg';
import { config } from '../packages/core/src/config';
import spec from '../docs/api/openapi.json';
import { id, seal } from '../packages/core/src/crypto';
import { resourceVerifierClientId, resourceVerifierSecret } from '../packages/core/src/oauth-settings';
import { release } from '../packages/cli/src/settings';
const customerScopes = Object.keys(
  spec.components.securitySchemes.CustomerOAuth.flows.authorizationCode.scopes,
);
const owner = new pg.Pool({ connectionString: config.ownerDatabaseUrl });
try {
  await owner.query('BEGIN');
  for (const resource of [
    { suffix: '/v1', name: 'Customer API', scopes: customerScopes },
    {
      suffix: '/admin/v1',
      name: 'Operator API',
      scopes: ['metrics:read', 'operations:read', 'accounts:read', 'accounts:pii:read'],
    },
    {
      suffix: '/admin/mcp',
      name: 'Operator MCP',
      scopes: ['metrics:read', 'operations:read', 'accounts:read', 'accounts:pii:read'],
    },
  ])
    await owner.query(
      `INSERT INTO auth."oauthResource"(id,identifier,name,"allowedScopes","accessTokenTtl","refreshTokenTtl",disabled,"policyVersion","createdAt","updatedAt")
      VALUES($1,$2,$3,$4,900,2592000,false,1,now(),now()) ON CONFLICT(identifier) DO UPDATE SET "allowedScopes"=excluded."allowedScopes","updatedAt"=now()`,
      [
        id(),
        config.origin + resource.suffix,
        resource.name,
        JSON.stringify([...resource.scopes, 'offline_access']),
      ],
    );
  await owner.query(
    `INSERT INTO auth."oauthClient"(id,"clientId",name,scopes,"redirectUris","tokenEndpointAuthMethod","applicationType","grantTypes","responseTypes","requirePKCE",disabled,"skipConsent","createdAt","updatedAt")
    VALUES($1,$2,$3,$4,'[]','none','native',$5,'[]',true,false,false,now(),now())
    ON CONFLICT ("clientId") DO UPDATE SET name=excluded.name,scopes=excluded.scopes,"grantTypes"=excluded."grantTypes","updatedAt"=now()`,
    [
      id(),
      release.clientId,
      `${config.name} CLI`,
      JSON.stringify([...customerScopes, 'offline_access']),
      JSON.stringify(['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']),
    ],
  );
  await owner.query(
    `INSERT INTO auth."oauthClientResource"(id,"clientId","resourceId","createdAt") VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING`,
    [id(), release.clientId, `${config.origin}/v1`],
  );
  await owner.query(
    `INSERT INTO auth."oauthClient"(id,"clientId","clientSecret",name,scopes,"redirectUris","tokenEndpointAuthMethod","applicationType","grantTypes","responseTypes",disabled,"skipConsent","createdAt","updatedAt")
    VALUES($1,$2,$3,'Internal resource verifier','[]','[]','client_secret_post','web','["client_credentials"]','[]',false,false,now(),now())
    ON CONFLICT("clientId") DO UPDATE SET "clientSecret"=excluded."clientSecret","updatedAt"=now()`,
    [id(), resourceVerifierClientId, seal(resourceVerifierSecret())],
  );
  for (const suffix of ['/v1', '/admin/v1', '/admin/mcp'])
    await owner.query(
      `INSERT INTO auth."oauthClientResource"(id,"clientId","resourceId","createdAt") VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING`,
      [id(), resourceVerifierClientId, config.origin + suffix],
    );
  await owner.query('COMMIT');
  console.log('Public CLI OAuth client provisioned. No embedded client secret.');
} finally {
  await owner.end();
}
