import { withFixtureDatabase } from './fixture-database';
import { command } from './coverage/processes';

await withFixtureDatabase((env) =>
  command(
    [
      'exec',
      'vitest',
      'run',
      ...(process.argv.length > 2
        ? process.argv.slice(2)
        : ['tests/unit', 'tests/integration', 'tests/git.test.ts', 'tests/git-sync.test.ts']),
    ],
    env,
  ),
);
