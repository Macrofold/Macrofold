import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { config, isLocal } from '../packages/core/src/config';
if (!isLocal() || config.allowPaid || config.execution !== 'simulator')
  throw new Error('Domain acceptance requires the unpaid local profile.');
const database = 'platform_test_' + Date.now(),
  directory = await mkdtemp(path.join(tmpdir(), 'platform-domain-'));
const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
await owner.connect();
let created = false;
async function command(args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Domain acceptance command failed.')),
    );
  });
}
try {
  await owner.query('CREATE DATABASE ' + database);
  created = true;
  const ownerURL = new URL(config.ownerDatabaseUrl),
    runtimeURL = new URL(config.databaseUrl);
  ownerURL.pathname = '/' + database;
  runtimeURL.pathname = '/' + database;
  const env = {
    ...process.env,
    MIGRATION_DATABASE_URL: ownerURL.href,
    DATABASE_URL: runtimeURL.href,
    AUTH_DATABASE_URL: runtimeURL.href,
    DATA_DIR: directory,
    PLATFORM_MODE: 'local',
    EXECUTION_PROVIDER: 'simulator',
    ALLOW_PAID_EXECUTION: 'false',
    GLOBAL_CONCURRENT_RUN_LIMIT: '50',
    RUN_ADMISSION_ENABLED: 'true',
    PUBLIC_SIGNUP_ENABLED: 'true',
  };
  // Dashboard transport tests consume the same exported SDK package as the app;
  // a fresh checkout must not depend on an ignored dist directory from an earlier build.
  await command(['--filter', '@hosted-agents/sdk', 'build'], env);
  for (const script of ['migrate', 'auth-migrate', 'provision-cli'])
    await command(['exec', 'tsx', 'scripts/' + script + '.ts'], env);
  await command(
    [
      'exec',
      'vitest',
      'run',
      ...(process.argv.length > 2
        ? process.argv.slice(2)
        : ['tests/unit', 'tests/integration', 'tests/git.test.ts', 'tests/git-sync.test.ts']),
    ],
    env,
  );
} finally {
  if (created) await owner.query('DROP DATABASE ' + database + ' WITH (FORCE)');
  await owner.end();
  await rm(directory, { recursive: true, force: true });
}
