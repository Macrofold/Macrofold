import { thresholds } from './scripts/coverage/policy.ts';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: process.env.VITEST_COVERAGE_DIR || 'coverage/domain',
      reporter: ['text-summary', 'html', 'lcov', 'json-summary', 'json'],
      reportOnFailure: true,
      // This is the canonical source inventory; external measurements never remove untouched files.
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'packages/db/index.ts',
        'sdk/typescript/src/**/*.ts',
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
