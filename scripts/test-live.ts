import { withFixtureDatabase } from './fixture-database';
import { command } from './coverage/processes';
import { pool, authPool } from '../packages/db';

if (process.env.LIVE_API_TESTS !== '1')
  throw new Error('Explicit LIVE_API_TESTS=1 authorization is required.');
const group = process.argv[2];
if (!['metadata', 'models', 'composio', 'resend', 'r2'].includes(group))
  throw new Error('Choose metadata, models, composio, resend or r2.');
try {
  if (group === 'models')
    await withFixtureDatabase((env) =>
      command(['exec', 'tsx', 'scripts/live/models.ts'], { ...env, LIVE_FIXTURE_CHILD: '1' }),
    );
  else await command(['exec', 'tsx', `scripts/live/${group}.ts`]);
} finally {
  await pool.end();
  await authPool.end();
}
