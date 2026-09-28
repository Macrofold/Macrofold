import { defineConfig } from '@playwright/test';
import { config, isLocal } from './packages/core/src/config';
// Browser fixtures and the running app must use the same local database settings.
if (!isLocal() || config.allowPaid || config.execution !== 'simulator')
  throw new Error('Browser acceptance requires the unpaid local profile.');
const sharedStateSpecs = [
  'dashboard-freshness.spec.ts',
  'docs.spec.ts',
  'landing.spec.ts',
  'operator.spec.ts',
  'pagination.spec.ts',
  'scheduling.spec.ts',
  'search-providers.spec.ts',
  'security.spec.ts',
  'storage.spec.ts',
  'team.spec.ts',
  'worktree-files.spec.ts',
].map((file) => `**/${file}`);
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  // Files run on parallel workers, each with its own seeded account (see the browser fixture).
  workers: Number(process.env.PLAYWRIGHT_WORKERS || 1),
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: config.origin,
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--host-resolver-rules=MAP localhost 127.0.0.1'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  outputDir: 'test-results',
  projects: [
    { name: 'isolated', testIgnore: sharedStateSpecs },
    // These journeys use the demo principal directly, database fixtures or deployment-wide
    // surfaces. They run afterwards, one file at a time, exactly as the suite did before.
    { name: 'shared-state', testMatch: sharedStateSpecs, dependencies: ['isolated'], workers: 1 },
  ],
});
