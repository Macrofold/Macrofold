import { getMigrations } from 'better-auth/db/migration';
import pg from 'pg';
import { auth } from '../packages/core/src/auth';
import { config } from '../packages/core/src/config';
import { authPool, pool } from '../packages/db';
const owner = new pg.Pool({
  connectionString: config.ownerDatabaseUrl,
  options: '-c search_path=auth,public',
});
try {
  const migrations = await getMigrations({ ...auth.options, database: owner });
  await migrations.runMigrations();
  // Expired authentication counters are bounded operational metadata, not identity history.
  await owner.query('CREATE INDEX IF NOT EXISTS auth_rate_expiry ON auth."rateLimit"("lastRequest")');
  const role = process.env.DATABASE_RUNTIME_ROLE || 'platform_app';
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('Invalid role');
  await owner.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA auth TO ${role}`);
  console.log('Better Auth/OAuth schema migrated.');
} finally {
  await owner.end();
  await authPool.end();
  await pool.end();
}
