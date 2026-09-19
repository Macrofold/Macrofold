import { afterEach, expect, it, vi } from 'vitest';
import {
  checkStaging,
  readyRuntime,
  stagingReleaseSettings,
  releaseStaging,
} from '../../scripts/releases/staging';
import { writeFile } from 'node:fs/promises';
vi.mock('node:fs/promises', () => ({ writeFile: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
const settings = {
  RELEASE_SHA: 'a'.repeat(40),
  VERCEL_ORG_ID: 'team',
  VERCEL_PROJECT_ID: 'staging',
  PRODUCTION_PROJECT_ID: 'production',
  VERCEL_TEAM_SLUG: 'example',
  VERCEL_PROJECT_NAME: 'app-staging',
  STAGING_ORIGIN: 'https://staging.example.test',
  STAGING_API_KEY: 'fixture',
  VERCEL_TOKEN: 'fixture',
  GITHUB_REPOSITORY: 'example/platform',
  MIGRATION_DATABASE_URL: 'postgres://owner:fixture@localhost/staging',
  DATABASE_URL: 'postgres://runtime:fixture@localhost/staging',
  AUTH_DATABASE_URL: 'postgres://runtime:fixture@localhost/staging',
  AUTH_SECRET: 'fixture-secret'.repeat(3),
  VAULT_KEY: 'fixture-key'.repeat(4),
  APP_ORIGIN: 'https://staging.example.test',
  PLATFORM_MODE: 'production',
  ALLOW_PAID_EXECUTION: 'false',
};
it('requires an immutable revision and a separate staging project', () => {
  expect(stagingReleaseSettings(settings).RELEASE_SHA).toHaveLength(40);
  expect(() => stagingReleaseSettings({ ...settings, VERCEL_PROJECT_ID: 'production' })).toThrow(
    'production',
  );
  expect(() => stagingReleaseSettings({ ...settings, RELEASE_SHA: 'main' })).toThrow();
  expect(() => stagingReleaseSettings({ ...settings, STAGING_ORIGIN: 'http://localhost' })).toThrow('HTTPS');
});
it('fails before publishing when required credentials or environment boundaries are missing', () => {
  for (const key of [
    'MIGRATION_DATABASE_URL',
    'DATABASE_URL',
    'AUTH_DATABASE_URL',
    'AUTH_SECRET',
    'VAULT_KEY',
    'VERCEL_TOKEN',
  ])
    expect(() => stagingReleaseSettings({ ...settings, [key]: '' })).toThrow();
  expect(() => stagingReleaseSettings({ ...settings, ALLOW_PAID_EXECUTION: 'true' })).toThrow();
  expect(() =>
    stagingReleaseSettings({ ...settings, APP_ORIGIN: 'https://production.example.test' }),
  ).toThrow('match staging');
});
it('accepts only ready immutable AMD64 runtime images', () => {
  const image = { manifestDigest: 'sha256:' + 'a'.repeat(64), status: 'ready', arch: 'amd64' };
  expect(readyRuntime(image)).toEqual(image);
  for (const override of [{ status: 'preparing' }, { arch: 'arm64' }, { manifestDigest: 'latest' }])
    expect(() => readyRuntime({ ...image, ...override })).toThrow();
});
it.each([503, 401, 302])('refuses promotion when deployed readiness returns %s', async (status) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
  await expect(checkStaging(settings.STAGING_ORIGIN, settings.STAGING_API_KEY)).rejects.toThrow('readiness');
});
it('verifies authenticated access after public readiness', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url) =>
      Response.json(String(url).endsWith('/health') ? { status: 'ok' } : {}),
    );
  await checkStaging(settings.STAGING_ORIGIN, settings.STAGING_API_KEY, 'bypass');
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(fetch.mock.calls[3][1]?.headers).toEqual({
    'x-vercel-protection-bypass': 'bypass',
    Authorization: 'Bearer fixture',
  });
});
function releaseFixture() {
  const invoke = vi.fn(async (program: string, args: string[]) => {
    if (program === 'git' || program === 'gh') return settings.RELEASE_SHA;
    if (args.includes('inspect'))
      return JSON.stringify({ status: 'ready', arch: 'amd64', manifestDigest: 'sha256:' + 'a'.repeat(64) });
    if (args.includes('deploy')) return 'https://candidate.vercel.app';
    return '';
  });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
    Response.json(String(url).endsWith('/health') ? { status: 'ok' } : {}),
  );
  return invoke;
}
it('publishes the verified runtime digest, migrates, verifies and promotes exactly its candidate', async () => {
  const invoke = releaseFixture();
  await releaseStaging({ ...settings, NODE_ENV: 'test' }, invoke);
  const calls = invoke.mock.calls.map(([program, args]) => `${program} ${args.join(' ')}`);
  expect(calls.filter((c) => c.startsWith('gh '))).toHaveLength(3);
  const migrated = calls.findIndex((c) => c.includes('scripts/migrate.ts'));
  const deployed = calls.findIndex((c) => c.includes(' deploy '));
  const promoted = calls.findIndex((c) => c.includes(' promote '));
  expect(migrated).toBeGreaterThan(calls.findIndex((c) => c.startsWith('docker push ')));
  expect(deployed).toBeGreaterThan(migrated);
  expect(promoted).toBeGreaterThan(deployed);
  expect(calls[deployed]).toContain('--env RUNTIME_IMAGE=agent-runtime@sha256:' + 'a'.repeat(64));
  expect(calls[promoted]).toContain('promote https://candidate.vercel.app');
  expect(writeFile).toHaveBeenLastCalledWith(
    'staging-release.json',
    expect.stringContaining('"promoted": true'),
  );
});
it.each(['stale', 'checkout', 'runtime', 'migration', 'deployment', 'readiness', 'newer-main'] as const)(
  'stops before promotion after %s failure',
  async (failure) => {
    const invoke = releaseFixture();
    const normal = invoke.getMockImplementation()!;
    let mainReads = 0;
    invoke.mockImplementation(async (program, args) => {
      if (program === 'gh') {
        mainReads++;
        if (failure === 'stale' || (failure === 'newer-main' && mainReads === 3)) return 'b'.repeat(40);
      }
      if (failure === 'checkout' && program === 'git') return 'b'.repeat(40);
      if (failure === 'runtime' && args.includes('inspect')) return JSON.stringify({ status: 'failed' });
      if (failure === 'migration' && args.includes('scripts/migrate.ts')) throw new Error('Migration failed');
      if (failure === 'deployment' && args.includes('deploy')) return 'Missing URL';
      return normal(program, args);
    });
    if (failure === 'readiness') vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await expect(releaseStaging({ ...settings, NODE_ENV: 'test' }, invoke)).rejects.toThrow();
    expect(invoke.mock.calls.some(([, args]) => args.includes('promote'))).toBe(false);
  },
);
