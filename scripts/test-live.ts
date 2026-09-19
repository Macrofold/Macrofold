import { withFixtureDatabase } from './fixture-database';
import { command } from './coverage/processes';
import { pool, authPool } from '../packages/db';

if (process.env.LIVE_API_TESTS !== '1')
  throw new Error('Explicit LIVE_API_TESTS=1 authorization is required.');
const group = process.argv[2];
if (!['metadata', 'models', 'decisions', 'tracing', 'composio', 'resend', 'r2'].includes(group))
  throw new Error('Choose metadata, models, decisions, tracing, composio, resend or r2.');
try {
  if (group === 'decisions' || group === 'tracing')
    await withFixtureDatabase((env) =>
      command(['exec', 'tsx', 'scripts/live/decisions.ts'], {
        ...env,
        LIVE_FIXTURE_CHILD: '1',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
        ...(group === 'tracing'
          ? {
              TRACING_ENABLED: 'true',
              LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY || '',
              LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY || '',
              LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL || '',
              LANGFUSE_TRACING_ENVIRONMENT: 'verification',
            }
          : {}),
      }),
    );
  else if (group === 'models')
    await withFixtureDatabase((env) =>
      command(['exec', 'tsx', 'scripts/live/models.ts'], { ...env, LIVE_FIXTURE_CHILD: '1' }),
    );
  else await command(['exec', 'tsx', `scripts/live/${group}.ts`]);
} finally {
  await pool.end();
  await authPool.end();
}
