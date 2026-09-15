import pg from 'pg';
import { parseArgs } from 'node:util';
import { config, isLocal } from '../packages/core/src/config';
import { connectorSetups } from '../packages/core/src/connector-enablement';
import { connectorSetupInput, enableConnector } from '../packages/core/src/connector-setup';
import { connectorSetupProvider } from '../packages/providers/src/connector-setup';
import { AppError } from '../packages/core/src/errors';

const { values } = parseArgs({
  options: {
    toolkit: { type: 'string' },
    inspect: { type: 'boolean' },
    enable: { type: 'boolean' },
    disable: { type: 'boolean' },
    version: { type: 'string' },
    'auth-config': { type: 'string' },
    managed: { type: 'boolean' },
    replace: { type: 'boolean' },
  },
});
if ([values.inspect, values.enable, values.disable].filter(Boolean).length > 1)
  throw new Error('Choose one action: --inspect, --enable or --disable.');
if (!values.toolkit && (values.inspect || values.enable || values.disable))
  throw new Error('Choose an app with --toolkit SLUG. Run without arguments to list persisted setup.');
if (!isLocal() && !process.env.MIGRATION_DATABASE_URL)
  throw new Error('Set MIGRATION_DATABASE_URL for the intended deployment.');
const db = new pg.Client({ connectionString: config.ownerDatabaseUrl });
await db.connect();
try {
  if (!values.toolkit) console.log(JSON.stringify(await connectorSetups(db), null, 2));
  else {
    const input = connectorSetupInput.parse({
      toolkit: values.toolkit,
      version: values.version,
      authConfig: values['auth-config'],
      managed: values.managed,
      replace: values.replace,
    });
    if (values.disable) {
      await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [`connector-setup:${input.toolkit}`]);
      await db.query('UPDATE connector_enablement SET enabled=false,updated_at=now() WHERE toolkit=$1', [
        input.toolkit,
      ]);
      console.log('Disabled new connections and tool dispatch for ' + input.toolkit);
    } else if (values.enable) {
      const result = await enableConnector(db, connectorSetupProvider(), input);
      console.log(
        JSON.stringify({ toolkit: result.toolkit, version: result.toolkit_version, enabled: result.enabled }),
      );
      console.log(
        'Next: verify the HTTPS callback, then connect an account in Connections and review Tools → Access. No customer accounts or tool grants were created.',
      );
    } else
      console.log(
        JSON.stringify(await connectorSetupProvider().inspect(input.toolkit, input.version), null, 2),
      );
  }
} catch (error) {
  // Provider exceptions may include credentials or response bodies. Only our safe domain messages leave setup.
  console.error(
    error instanceof AppError
      ? error.message
      : 'Setup did not complete. Inspect the provider Auth Configs before retrying a managed creation. See docs/features/identity-integrations/composio.md.',
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
