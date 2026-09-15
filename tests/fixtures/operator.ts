import pg from 'pg';
import { config } from '../../packages/core/src/config';

/** Deployment setup is intentionally unavailable to the serving database role. */
export async function fixtureOperator<T>(work: (db: pg.Client) => Promise<T>) {
  const db = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  await db.connect();
  try {
    return await work(db);
  } finally {
    await db.end();
  }
}

export function fixtureConnector(toolkit = 'gmail') {
  return fixtureOperator((db) => db.query(`INSERT INTO connector_enablement
    (toolkit,auth_config_id,toolkit_version,enabled) VALUES($1,'fixture-auth','fixture-version',true)
    ON CONFLICT(toolkit) DO UPDATE SET auth_config_id=excluded.auth_config_id,
    toolkit_version=excluded.toolkit_version,enabled=true,creation_pending=false`, [toolkit]));
}
