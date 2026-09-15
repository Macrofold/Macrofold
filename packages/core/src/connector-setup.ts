import type pg from 'pg';
import { z } from 'zod';
import { assert } from './errors';
import type { ConnectorSetup, ConnectorSetupProvider } from './connector-enablement';

export const connectorSetupInput = z.object({
  toolkit: z.string().regex(/^[a-z0-9_][a-z0-9_-]{0,99}$/),
  version: z
    .string()
    .min(1)
    .max(100)
    .refine((v) => v !== 'latest')
    .optional(),
  authConfig: z.string().min(1).max(200).optional(),
  managed: z.boolean().default(false),
  replace: z.boolean().default(false),
});

/** Operator-only, dedicated autocommit connection: a session lock, never a tenant transaction
 * across provider I/O. The serving role cannot write this table. A pending POST survives crashes. */
export async function enableConnector(
  db: pg.Client,
  provider: ConnectorSetupProvider,
  raw: z.input<typeof connectorSetupInput>,
) {
  const input = connectorSetupInput.parse(raw);
  const lock = `connector-setup:${input.toolkit}`;
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock]);
  try {
    const current = (
      await db.query<ConnectorSetup>('SELECT * FROM connector_enablement WHERE toolkit=$1', [input.toolkit])
    ).rows[0];
    const changing =
      !!current &&
      ((input.version && input.version !== current.toolkit_version) ||
        (input.authConfig && input.authConfig !== current.auth_config_id));
    assert(
      !changing || input.replace,
      409,
      'setup_review_required',
      'Use --replace after reviewing the new auth configuration or toolkit version.',
    );
    if (current?.enabled && !changing) return current;
    const discovered = await provider.inspect(input.toolkit, input.version || current?.toolkit_version);
    const candidate = input.authConfig || current?.auth_config_id;
    const managedConfigs = discovered.authConfigs.filter(
      (c) => c.name === `platform-managed:${input.toolkit}`,
    );
    let auth = candidate
      ? discovered.authConfigs.find((c) => c.id === candidate)
      : (managedConfigs.length === 1 ? managedConfigs[0] : undefined) ||
        (discovered.authConfigs.length === 1 ? discovered.authConfigs[0] : undefined);
    assert(
      !candidate || auth,
      400,
      'invalid_auth_config',
      'Choose an enabled auth configuration for this toolkit from --inspect.',
    );
    if (!auth) {
      assert(
        !current?.creation_pending,
        409,
        'auth_creation_uncertain',
        'A previous auth creation may have succeeded. Inspect Auth Configs and select its ID with --auth-config; no creation was retried.',
      );
      assert(
        discovered.authConfigs.length === 0,
        409,
        'auth_config_choice_required',
        'Several auth configurations exist. Inspect them and select one with --auth-config.',
      );
      assert(
        input.managed && discovered.managed,
        409,
        'auth_config_required',
        'Use --managed for supported managed authentication, or create a custom Auth Config in the provider dashboard and select it with --auth-config.',
      );
      await db.query(
        `INSERT INTO connector_enablement(toolkit,toolkit_version,creation_pending) VALUES($1,$2,true)
        ON CONFLICT(toolkit) DO UPDATE SET creation_pending=true,enabled=false,updated_at=now()`,
        [input.toolkit, discovered.version],
      );
      const authId = await provider.createManaged(input.toolkit);
      auth = { id: authId, name: `platform-managed:${input.toolkit}` };
    }
    return (
      await db.query<ConnectorSetup>(
        `INSERT INTO connector_enablement(toolkit,auth_config_id,toolkit_version,enabled,creation_pending)
      VALUES($1,$2,$3,true,false) ON CONFLICT(toolkit) DO UPDATE SET auth_config_id=excluded.auth_config_id,
      toolkit_version=excluded.toolkit_version,enabled=true,creation_pending=false,updated_at=now() RETURNING *`,
        [input.toolkit, auth.id, discovered.version],
      )
    ).rows[0];
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
  }
}
