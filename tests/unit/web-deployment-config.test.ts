import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it.each([
  { vercel: '1', output: undefined },
  { vercel: undefined, output: 'standalone' },
  { vercel: '0', output: 'standalone' },
])('selects compatible packaging with VERCEL=$vercel', async ({ vercel, output }) => {
  vi.stubEnv('VERCEL', vercel);
  vi.resetModules();
  const { default: configure } = await import('../../apps/web/next.config');
  // Use the real Workflow wrapper without generating build/dev artifacts in this checkout.
  const config = await configure('phase-production-server', { defaultConfig: {} });
  expect(config.output).toBe(output);
  expect(config.serverExternalPackages).toContain('pg');
});
