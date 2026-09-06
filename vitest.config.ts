import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'html', 'lcov', 'json-summary'],
      reportOnFailure: true,
      // Count unimported application code too. Browser/subprocess checks are separate
      // acceptance evidence and do not contribute to this in-process TS report.
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'packages/db/index.ts',
        'sdk/typescript/src/**/*.ts',
        'apps/web/{app,components,lib,workflows}/**/*.{ts,tsx}',
      ],
      exclude: ['**/*.d.ts', 'sdk/typescript/src/routes.ts'],
      // Floors reflect the measured in-process suite, not browser or native coverage.
      // Raise them as coverage grows; do not exclude untested code to meet a target.
      thresholds: {
        lines: 46,
        statements: 44,
        branches: 36,
        functions: 35,
        'packages/core/src/runtime-auth.ts': { 100: true },
        'packages/core/src/ledger.ts': { lines: 100, statements: 98, branches: 90, functions: 100 },
        'packages/core/src/runs.ts': { lines: 95, statements: 94, branches: 90, functions: 92 },
        'packages/core/src/auth.ts': { lines: 86, statements: 84, branches: 59, functions: 78 },
        'packages/core/src/actor-authorization.ts': {
          lines: 80,
          statements: 76,
          branches: 76,
          functions: 100,
        },
        'packages/core/src/cloud-engine.ts': { lines: 93, statements: 91, branches: 77, functions: 90 },
        'packages/runtime/src/manifest.ts': { lines: 97, statements: 94, branches: 86, functions: 100 },
        'packages/runtime/src/restore.ts': { lines: 83, statements: 80, branches: 78, functions: 100 },
      },
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
