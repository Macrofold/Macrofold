import 'dotenv/config';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { config } from '../packages/core/src/config';
const client = new pg.Client({ connectionString: config.ownerDatabaseUrl });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(321017)');
  if (
    (await client.query("SELECT 1 FROM pg_roles WHERE rolname='platform_reporting'")).rowCount &&
    (await client.query("SELECT 1 FROM pg_namespace WHERE nspname='reporting'")).rowCount
  )
    await client.query('GRANT CREATE ON SCHEMA reporting TO platform_reporting');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  );
  const directory = new URL('../packages/db/', import.meta.url);
  for (const file of (await readdir(directory)).filter((n) => /^\d+_.+\.sql$/.test(n)).sort()) {
    const version = file.split('_')[0];
    const done = await client.query('SELECT version FROM schema_migrations WHERE version=$1', [version]);
    if (!done.rowCount) {
      await client.query(await readFile(new URL(file, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    }
  }
  if (config.mode === 'local')
    await client.query(
      "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='platform_app') THEN CREATE ROLE platform_app LOGIN PASSWORD 'local-app-only' NOBYPASSRLS; END IF; END $$",
    );
  const role = process.env.DATABASE_RUNTIME_ROLE || 'platform_app';
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('Invalid database role name');
  await client.query(
    `GRANT USAGE ON SCHEMA public,auth TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public,auth TO ${role}; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public,auth TO ${role};`,
  );
  await client.query(
    `GRANT USAGE ON SCHEMA reporting TO ${role}; GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO ${role};`,
  );
  await client.query(
    `REVOKE UPDATE,DELETE,TRUNCATE ON ledger,financial_events,billing_events,admin_audit FROM ${role}`,
  );
  await client.query('REVOKE CREATE ON SCHEMA reporting FROM platform_reporting');
  await client.query('COMMIT');
  console.log('Database migrations applied.');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
