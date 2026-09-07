import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { release } from '../../packages/cli/src/settings';
import { saveProfile, selectedProfile, tokenFor, logout } from '../../packages/cli/src/profiles';

const originalDirectory = release.configDirectory;
let directory: string | undefined;
afterEach(async () => {
  release.configDirectory = originalDirectory;
  vi.unstubAllGlobals();
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
