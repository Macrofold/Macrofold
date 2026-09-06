import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config, isLocal } from '../packages/core/src/config';
import { id, seal, token } from '../packages/core/src/crypto';
const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    output: { type: 'string' },
    pii: { type: 'boolean' },
    rotate: { type: 'boolean' },
    disable: { type: 'boolean' },
  },
});
const clientId = values.name || 'operator-agent';
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(clientId))
  throw new Error('Use a short --name with letters, numbers, underscores and hyphens.');
if (!isLocal() && !process.env.MIGRATION_DATABASE_URL)
  throw new Error('MIGRATION_DATABASE_URL is required for operator provisioning.');
const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
await owner.connect();
try {
  await owner.query('BEGIN');
  if (values.disable) {
    await owner.query('UPDATE service_clients SET enabled=false WHERE client_id=$1', [clientId]);
    await owner.query('UPDATE auth."oauthClient" SET disabled=true WHERE "clientId"=$1', [clientId]);
    await owner.query('COMMIT');
    console.log(`Disabled operator client ${clientId}. Existing access is rejected immediately.`);
  } else {
    const existing = await owner.query('SELECT id FROM auth."oauthClient" WHERE "clientId"=$1', [clientId]);
    if (existing.rowCount && !values.rotate)
      throw new Error(
        'This client exists. Use --rotate to replace its credentials or --disable to revoke it.',
      );
    const scopes = [
        'metrics:read',
        'operations:read',
        'accounts:read',
        ...(values.pii ? ['accounts:pii:read'] : []),
      ],
      secret = token();
    const destination = path.resolve(values.output || path.join(config.dataDir, `${clientId}.json`));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await owner.query(
      `INSERT INTO auth."oauthClient"(id,"clientId","clientSecret",name,scopes,"clientCredentialsScopes","redirectUris","tokenEndpointAuthMethod","applicationType","grantTypes","responseTypes",disabled,"skipConsent","createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$5,'[]','client_secret_post','web','["client_credentials"]','[]',false,false,now(),now()) ON CONFLICT("clientId") DO UPDATE SET "clientSecret"=excluded."clientSecret",scopes=excluded.scopes,"clientCredentialsScopes"=excluded."clientCredentialsScopes",disabled=false,"updatedAt"=now()`,
      [id(), clientId, seal(secret), clientId, JSON.stringify(scopes)],
    );
    for (const suffix of ['/admin/v1', '/admin/mcp'])
      await owner.query(
        'INSERT INTO auth."oauthClientResource"(id,"clientId","resourceId","createdAt") VALUES($1,$2,$3,now()) ON CONFLICT DO NOTHING',
        [id(), clientId, config.origin + suffix],
      );
    await owner.query(
      'INSERT INTO service_clients(client_id,scopes) VALUES($1,$2) ON CONFLICT(client_id) DO UPDATE SET scopes=excluded.scopes,enabled=true',
      [clientId, scopes],
    );
    if (values.rotate)
      await owner.query('DELETE FROM auth."oauthAccessToken" WHERE "clientId"=$1', [clientId]);
    await writeFile(
      destination,
      JSON.stringify(
        {
          client_id: clientId,
          client_secret: secret,
          token_endpoint: `${config.origin}/auth/oauth2/token`,
          scope: scopes.join(' '),
          resources: [`${config.origin}/admin/v1`, `${config.origin}/admin/mcp`],
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    await owner.query('COMMIT');
    console.log(
      `Operator credential saved to ${destination}. Request a separate access token for each resource audience. Store this file in your secret manager.`,
    );
  }
} catch (error) {
  await owner.query('ROLLBACK');
  throw error;
} finally {
  await owner.end();
}
