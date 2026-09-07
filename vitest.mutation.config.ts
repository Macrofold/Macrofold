import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/runtime-capability.test.ts', 'tests/unit/execution-policy.test.ts'],
    testTimeout: 10000,
    fileParallelism: false,
    env: {
      PLATFORM_MODE: 'local',
      APP_ORIGIN: 'http://localhost:3210',
      EXECUTION_PROVIDER: 'simulator',
      ALLOW_PAID_EXECUTION: 'false',
      VERCEL_ENV: '',
      VAULT_KEY: 'mutation-fixture-key-never-a-production-secret',
      VAULT_KEYRING_JSON: '{}',
      VAULT_ACTIVE_KEY_ID: '',
    },
  },
});
