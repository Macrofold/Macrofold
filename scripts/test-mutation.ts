import { withFixtureDatabase } from './fixture-database';
import { command } from './coverage/processes';
await withFixtureDatabase((env) =>
  command(['exec', 'stryker', 'run', 'stryker.critical.config.json', ...process.argv.slice(2)], env),
);
