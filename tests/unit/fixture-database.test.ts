import { afterEach, expect, it, vi } from 'vitest';
import { withFixtureDatabase } from '../../scripts/fixture-database';

vi.mock('pg', () => ({
  default: {
    Client: class {
      connect = async () => {};
      query = async () => ({ rows: [] });
      end = async () => {};
    },
  },
}));
vi.mock('../../scripts/coverage/processes', () => ({ command: async () => {} }));
vi.mock('../../packages/core/src/config', () => ({
  isLocal: () => true,
  config: {
    allowPaid: false,
    execution: 'simulator',
    ownerDatabaseUrl: 'postgres://owner:fixture-only@127.0.0.1/platform',
    databaseUrl: 'postgres://runtime:fixture-only@127.0.0.1/platform',
  },
}));
afterEach(() => vi.unstubAllEnvs());

it('keeps ordinary fixture observations enabled despite developer opt-outs', async () => {
  vi.stubEnv('REQUEST_ANALYTICS_ENABLED', 'false');
  vi.stubEnv('API_PRODUCT_EVENTS_ENABLED', 'false');
  await withFixtureDatabase(async (env) => {
    expect(env.REQUEST_ANALYTICS_ENABLED).toBe('true');
    expect(env.API_PRODUCT_EVENTS_ENABLED).toBe('true');
    expect(env.PERF_PROFILING_ENABLED).toBe('false');
    expect(env.TRACING_ENABLED).toBe('false');
    expect(env.ALLOW_PAID_EXECUTION).toBe('false');
    expect(new URL(env.DATABASE_URL!).pathname).toMatch(/^\/platform_test_[a-f0-9]+$/);
  });
});
