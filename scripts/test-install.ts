import pg from 'pg';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config, isLocal } from '../packages/core/src/config';
if (!isLocal()) throw new Error('Installation validation is local only.');
const database = `platform_install_${Date.now()}`,
  directory = await mkdtemp(path.join(tmpdir(), 'platform-install-'));
const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
await owner.connect();
let created = false,
  restoredCreated = false,
  roleCreated = false;
const restoredDatabase = database + '_restored';
const migrationRole = database + '_migrator',
  migrationPassword = crypto.randomUUID();
try {
  // Model managed PostgreSQL: the schema owner can create roles but is neither a
  // superuser nor a BYPASSRLS role. Local superuser-only success is insufficient.
  await owner.query(
    `CREATE ROLE ${migrationRole} LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD '${migrationPassword}'`,
  );
  roleCreated = true;
  if ((await owner.query("SELECT 1 FROM pg_roles WHERE rolname='platform_reporting'")).rowCount)
    await owner.query(`GRANT platform_reporting TO ${migrationRole} WITH ADMIN OPTION`);
  await owner.query(`CREATE DATABASE ${database} OWNER ${migrationRole}`);
  created = true;
  const ownerURL = new URL(config.ownerDatabaseUrl),
    runtimeURL = new URL(config.databaseUrl);
  ownerURL.pathname = '/' + database;
  runtimeURL.pathname = '/' + database;
  const migrationURL = new URL(ownerURL);
  migrationURL.username = migrationRole;
  migrationURL.password = migrationPassword;
  const env = {
    ...process.env,
    MIGRATION_DATABASE_URL: migrationURL.href,
    DATABASE_URL: runtimeURL.href,
    AUTH_DATABASE_URL: runtimeURL.href,
    DATA_DIR: directory,
    PLATFORM_MODE: 'local',
    EXECUTION_PROVIDER: 'simulator',
    ALLOW_PAID_EXECUTION: 'false',
  };
  for (const script of ['migrate', 'auth-migrate', 'provision-cli', 'seed', 'doctor']) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pnpm', ['exec', 'tsx', `scripts/${script}.ts`], { env, stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`Fresh install failed at ${script}`)),
      );
    });
  }
  const rotated = {
    ...env,
    VAULT_ACTIVE_KEY_ID: 'fixture-rotation',
    VAULT_KEYRING_JSON: JSON.stringify({
      'fixture-rotation': 'fixture-rotation-key-that-is-only-for-local-tests',
    }),
  };
  for (const flags of [['--write', '--confirm-paused'], []]) {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn('pnpm', ['exec', 'tsx', 'scripts/rewrap-vault.ts', ...flags], {
        env: rotated,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '',
        error = '';
      child.stdout.on('data', (d) => {
        output += d;
      });
      child.stderr.on('data', (d) => {
        error += d;
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(output) : reject(new Error('Fresh-install key rotation failed: ' + error)),
      );
    });
    const result = JSON.parse(output.trim());
    if (!result.encrypted_values_inspected || (!flags.length && result.values_requiring_rewrap !== 0))
      throw new Error('Key rotation verification was incomplete');
  }
  // Recovery rehearsal uses a separate database and independent object copy. No mutation
  // of the source instance is needed, and all credentials remain in the private temp folder.
  const restoredDirectory = directory + '-restored';
  await cp(directory, restoredDirectory, { recursive: true });
  try {
    const container = process.env.TEST_POSTGRES_CONTAINER || 'hosted-agent-platform-postgres-1';
    const dump = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'exec',
          container,
          'pg_dump',
          '-U',
          decodeURIComponent(ownerURL.username),
          '--format=custom',
          database,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const chunks: Buffer[] = [];
      child.stdout.on('data', (d) => chunks.push(d));
      child.stderr.resume();
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Database backup failed')),
      );
    });
    await owner.query(`CREATE DATABASE ${restoredDatabase}`);
    restoredCreated = true;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'docker',
        [
          'exec',
          '-i',
          container,
          'pg_restore',
          '-U',
          decodeURIComponent(ownerURL.username),
          '--exit-on-error',
          '--dbname',
          restoredDatabase,
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      child.stderr.resume();
      child.stdin.end(dump);
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Database restore failed'))));
    });
    const restoredURL = new URL(runtimeURL);
    restoredURL.pathname = '/' + restoredDatabase;
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pnpm', ['exec', 'tsx', 'scripts/test-restored.ts'], {
        env: {
          ...rotated,
          DATABASE_URL: restoredURL.href,
          AUTH_DATABASE_URL: restoredURL.href,
          DATA_DIR: restoredDirectory,
        },
        stdio: 'inherit',
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error('Restored application verification failed')),
      );
    });
  } finally {
    await rm(restoredDirectory, { recursive: true, force: true });
  }
  console.log(
    'Fresh-database installation, auth migration, OAuth provisioning, local seeding, readiness and persistent key rotation passed.',
  );
} finally {
  if (restoredCreated) await owner.query(`DROP DATABASE ${restoredDatabase} WITH (FORCE)`);
  if (created) await owner.query(`DROP DATABASE ${database} WITH (FORCE)`);
  if (roleCreated) await owner.query(`DROP ROLE ${migrationRole}`);
  await owner.end();
  await rm(directory, { recursive: true, force: true });
}
