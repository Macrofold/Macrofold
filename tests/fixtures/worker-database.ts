import { mkdirSync } from 'node:fs';
import path from 'node:path';

// Runs before each test file and before application modules read their configuration.
// Parallel workers each use their own template clone and object directory.
const clones = (process.env.FIXTURE_DATABASES || '').split(',').filter(Boolean);
if (clones.length) {
  const index = Number(process.env.VITEST_POOL_ID) - 1;
  const database = clones[index];
  if (!database) throw new Error(`No fixture database for Vitest worker ${process.env.VITEST_POOL_ID}`);
  for (const key of ['DATABASE_URL', 'AUTH_DATABASE_URL', 'MIGRATION_DATABASE_URL']) {
    const url = new URL(process.env[key]!);
    url.pathname = '/' + database;
    process.env[key] = url.href;
  }
  process.env.DATA_DIR = path.join(process.env.FIXTURE_DATA_ROOT!, database);
  mkdirSync(process.env.DATA_DIR, { recursive: true, mode: 0o700 });
}
