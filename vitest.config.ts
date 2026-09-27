import { thresholds } from './scripts/coverage/policy.ts';
import { defineConfig } from 'vitest/config';
// The domain wrapper provides one cloned database per worker (tests/fixtures/worker-database.ts).
// Without it, files share one database and must stay serial because scheduling is global.
const workers = Math.max(1, Number(process.env.DOMAIN_TEST_WORKERS || 1));
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: workers > 1,
    maxWorkers: workers,
    setupFiles: ['./tests/fixtures/worker-database.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: process.env.VITEST_COVERAGE_DIR || 'coverage/domain',
      reporter: ['text-summary', 'html', 'lcov', 'json-summary', 'json'],
      reportOnFailure: true,
      // This is the canonical source inventory; external measurements never remove untouched files.
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'packages/db/index.ts',
        'sdk/typescript/src/**/*.{ts,tsx}',
        'apps/web/{app,components,lib,workflows}/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.d.ts', 'sdk/typescript/src/routes.ts'],
      // Floors reflect the measured in-process suite, not browser or native coverage.
      // Raise them as coverage grows; do not exclude untested code to meet a target.
      thresholds,
    },
  },
  resolve: {
    alias: {
      '@platform/providers': new URL('./packages/providers/src', import.meta.url).pathname,
      '@platform/core': new URL('./packages/core/src', import.meta.url).pathname,
      '@platform/db': new URL('./packages/db/index.ts', import.meta.url).pathname,
    },
  },
});
