import { availableParallelism } from 'node:os';
import { withFixtureDatabase } from './fixture-database';
import { command } from './coverage/processes';

// Fresh checkouts do not contain the generated public documentation module.
await command(['docs:generate']);

const targets =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ['tests/unit', 'tests/integration', 'tests/git.test.ts', 'tests/git-sync.test.ts'];
// Load tests measure capacity and stay serial. Other files run in parallel, one database each.
const workers = targets.some((target) => target.startsWith('tests/load'))
  ? 1
  : Math.max(1, Math.min(4, Number(process.env.DOMAIN_TEST_WORKERS || availableParallelism())));
await withFixtureDatabase(
  (env) => command(['exec', 'vitest', 'run', ...targets], { ...env, DOMAIN_TEST_WORKERS: String(workers) }),
  { workers },
);
