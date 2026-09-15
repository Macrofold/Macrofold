import { pool, type Tx } from '../../db';
import { assert } from './errors';

export type ConnectorSetup = {
  toolkit: string;
  auth_config_id: string | null;
  toolkit_version: string;
  enabled: boolean;
  creation_pending: boolean;
};
export async function connectorSetups(db: Pick<Tx, 'query'> = pool) {
  return (await db.query<ConnectorSetup>('SELECT * FROM connector_enablement ORDER BY toolkit')).rows;
}
export async function enabledConnector(toolkit: string, db: Pick<Tx, 'query'> = pool) {
  const setup = (
    await db.query<ConnectorSetup>('SELECT * FROM connector_enablement WHERE toolkit=$1', [toolkit])
  ).rows[0];
  assert(
    setup?.enabled && setup.auth_config_id && !setup.creation_pending,
    503,
    'integration_not_configured',
    'This app needs operator setup. Ask your operator to follow the connector enablement guide.',
  );
  return { ...setup, auth_config_id: setup.auth_config_id };
}

/** Domain port for setup metadata; provider credentials/SDK objects never leave the adapter. */
export interface ConnectorSetupProvider {
  inspect(
    toolkit: string,
    version?: string,
  ): Promise<{
    version: string;
    managed: boolean;
    authConfigs: { id: string; name: string }[];
  }>;
  createManaged(toolkit: string): Promise<string>;
}
