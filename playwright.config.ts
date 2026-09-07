import { defineConfig } from '@playwright/test';
import { config, isLocal } from './packages/core/src/config';
// Browser fixtures and the running app must use the same local database settings.
if (!isLocal() || config.allowPaid || config.execution !== 'simulator')
  throw new Error('Browser acceptance requires the unpaid local profile.');
export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
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
});
