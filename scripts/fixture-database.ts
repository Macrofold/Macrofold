import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { config, isLocal } from '../packages/core/src/config';
import { command } from './coverage/processes';

export async function withFixtureDatabase(run: (env: NodeJS.ProcessEnv) => Promise<void>) {
  if (!isLocal() || config.allowPaid || config.execution !== 'simulator')
    throw new Error('Acceptance requires the unpaid local profile.');
  const database = 'platform_test_' + randomUUID().replaceAll('-', '');
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-tests-'));
  const owner = new pg.Client({ connectionString: config.ownerDatabaseUrl });
  let created = false;
  try {
    await owner.connect();
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
      // Catalog discovery is free but must not inherit developer credentials.
      COMPOSIO_API_KEY: '',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      TYPESAFE_API_KEY: '',
      OPENROUTER_API_KEY: '',
      TRACING_ENABLED: 'false',
      LANGFUSE_PUBLIC_KEY: '',
      LANGFUSE_SECRET_KEY: '',
      LANGFUSE_BASE_URL: '',
      COMPOSIO_CALLBACK_VERIFICATION_ENABLED: 'false',
      GLOBAL_CONCURRENT_RUN_LIMIT: '50',
      RUN_ADMISSION_ENABLED: 'true',
      PUBLIC_SIGNUP_ENABLED: 'true',
    };
    await command(['--filter', 'macrofold', 'build'], env);
    for (const script of ['migrate', 'auth-migrate', 'provision-cli'])
      await command(['exec', 'tsx', 'scripts/' + script + '.ts'], env);
    // Default fixtures never refresh vendor metadata, even if a test selects native execution.
    // Catalog tests explicitly make their isolated rows due and inject deterministic sources.
    const fixture = new pg.Client({ connectionString: runtimeURL.href });
    await fixture.connect();
    try {
      await fixture.query("UPDATE model_catalog_cache SET refresh_after=now()+interval '1 day'");
    } finally {
      await fixture.end();
    }
    await run(env);
  } finally {
    try {
      if (created) await owner.query('DROP DATABASE ' + database + ' WITH (FORCE)');
    } finally {
      await owner.end();
      await rm(directory, { recursive: true, force: true });
    }
  }
}
