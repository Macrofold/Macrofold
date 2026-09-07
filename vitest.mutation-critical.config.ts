import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'tests/integration/auth-boundaries.test.ts',
      'tests/integration/actor-guard.test.ts',
      'tests/integration/ledger-boundaries.test.ts',
      'tests/unit/snapshot-failures.test.ts',
      'tests/unit/manifest.test.ts',
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
