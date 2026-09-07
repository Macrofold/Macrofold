import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, stat, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { release } from '../../packages/cli/src/settings';
import { saveProfile, selectedProfile, tokenFor, logout } from '../../packages/cli/src/profiles';

const originalDirectory = release.configDirectory;
let directory: string | undefined;
afterEach(async () => {
  release.configDirectory = originalDirectory;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (directory) await rm(directory, { recursive: true, force: true });
});

it('serializes logout behind token refresh and revokes the current refresh token', async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'cli-profile-race-'));
  release.configDirectory = directory;
  await saveProfile('fixture', {
    origin: 'https://agents.example.test',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: 0,
  });
  let finishRefresh!: (response: Response) => void;
  const refresh = new Promise<Response>((resolve) => {
    finishRefresh = resolve;
  });
  const revocations: string[] = [];
  const http = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/token')) return refresh;
    if (String(url).endsWith('/revoke')) {
      revocations.push(new URLSearchParams(String(init?.body)).get('token')!);
      return Response.json({});
    }
    throw new Error('Unexpected network');
  });
  vi.stubGlobal('fetch', http);
  const updating = tokenFor('fixture');
  await vi.waitFor(() => expect(http).toHaveBeenCalledOnce());
  const removing = logout('fixture');
  // The profile is still locked by refresh. Give logout an opportunity to read it.
  await new Promise((resolve) => setTimeout(resolve, 100));
  finishRefresh(Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 900 }));
  expect(await updating).toBe('new-access');
  expect(await removing).toEqual({ removed: true, revoked: true });
  expect(revocations).toEqual(['new-refresh']);
  await expect(selectedProfile('fixture')).rejects.toMatchObject({ code: 'login_required' });
});

async function profileFixture(expiresAt = 0) {
  directory = await mkdtemp(path.join(tmpdir(), 'cli-credentials-'));
  release.configDirectory = directory;
  const profile = {
    origin: 'https://agents.example.test',
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt,
  };
  await saveProfile('fixture', profile);
  return profile;
}
it.each([60001, 60000, 59999])(
  'refreshes only within the 60-second expiry window (%i ms)',
  async (remaining) => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    await profileFixture(now + remaining);
    const http = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: 'new-access', expires_in: 900 }),
    );
    vi.stubGlobal('fetch', http);
    expect(await tokenFor('fixture')).toBe(remaining > 60000 ? 'old-access' : 'new-access');
    expect(http).toHaveBeenCalledTimes(remaining > 60000 ? 0 : 1);
    expect((await selectedProfile('fixture')).profile.refreshToken).toBe('old-refresh');
  },
);
it('retains credentials and releases the lock after a rejected refresh', async () => {
  const original = await profileFixture();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 })),
  );
  await expect(tokenFor('fixture')).rejects.toMatchObject({ code: 'invalid_grant' });
  expect((await selectedProfile('fixture')).profile).toEqual(original);
  await expect(stat(path.join(directory!, 'profiles.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  await saveProfile('fixture', { origin: original.origin, apiKey: 'replacement' });
  expect(await tokenFor('fixture')).toBe('replacement');
});
it('recovers a stale lock only after its owner has exited', async () => {
  await profileFixture(Date.now() + 900000);
  const lock = path.join(directory!, 'profiles.lock');
  await writeFile(lock, JSON.stringify({ pid: 2147483647, created: Date.now() - 120001 }), { mode: 0o600 });
  expect(await tokenFor('fixture')).toBe('old-access');
  await expect(stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await stat(path.join(directory!, 'profiles.json'))).mode & 0o777).toBe(0o600);
});
it.each(['live-owner', 'incomplete-lock'])(
  'does not steal a %s lock or overwrite credentials',
  async (kind) => {
    await profileFixture(Date.now() + 900000);
    const lock = path.join(directory!, 'profiles.lock');
    const contents =
      kind === 'live-owner' ? JSON.stringify({ pid: process.pid, created: Date.now() - 200000 }) : '{';
    await writeFile(lock, contents, { mode: 0o600 });
    const previous = await readFile(path.join(directory!, 'profiles.json'), 'utf8');
    await expect(tokenFor('fixture')).rejects.toThrow('Another CLI process');
    expect(await readFile(lock, 'utf8')).toBe(contents);
    expect(await readFile(path.join(directory!, 'profiles.json'), 'utf8')).toBe(previous);
  },
  15000,
);
it.each(['public-file', 'symlink', 'corrupt-json'])(
  'rejects %s credentials without replacing them',
  async (kind) => {
    await profileFixture();
    const file = path.join(directory!, 'profiles.json');
    if (kind === 'public-file') await chmod(file, 0o644);
    if (kind === 'symlink') {
      await rm(file);
      await symlink('missing-secret', file);
    }
    if (kind === 'corrupt-json') await writeFile(file, '{');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('No request expected');
      }),
    );
    await expect(tokenFor('fixture')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(stat(path.join(directory!, 'profiles.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  },
);
it('requires login for expired credentials without a refresh token', async () => {
  await profileFixture();
  await saveProfile('fixture', {
    origin: 'https://agents.example.test',
    accessToken: 'expired',
    expiresAt: 0,
  });
  vi.stubGlobal('fetch', vi.fn());
  await expect(tokenFor('fixture')).rejects.toMatchObject({ code: 'login_required' });
  expect(fetch).not.toHaveBeenCalled();
});
