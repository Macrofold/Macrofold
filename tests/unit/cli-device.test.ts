import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { release } from '../../packages/cli/src/settings';
import { deviceLogin, selectedProfile } from '../../packages/cli/src/profiles';

const originalDirectory = release.configDirectory;
let directory: string | undefined;
afterEach(async () => {
  release.configDirectory = originalDirectory;
  vi.unstubAllGlobals();
  if (directory) await rm(directory, { recursive: true, force: true });
});
const origin = 'https://agents.example.test';
const device = {
  device_code: 'device',
  user_code: 'ABCD',
  verification_uri: '/device',
  expires_in: 600,
  interval: 1,
};
const tokens = { access_token: 'access', refresh_token: 'refresh', expires_in: 900 };
async function isolate() {
  directory = await mkdtemp(path.join(tmpdir(), 'cli-device-'));
  release.configDirectory = directory;
}

it('does not request a device code when login was already cancelled', async () => {
  const http = vi.fn();
  vi.stubGlobal('fetch', http);
  const controller = new AbortController();
  controller.abort();
  await expect(
    deviceLogin({ origin, profile: 'fixture', signal: controller.signal, onCode: vi.fn() }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(http).not.toHaveBeenCalled();
});

it('interrupts a polling sleep without requesting tokens or saving credentials', async () => {
  await isolate();
  const http = vi.fn<typeof fetch>(async () => Response.json(device));
  vi.stubGlobal('fetch', http);
  const controller = new AbortController();
  const login = deviceLogin({
    origin,
    profile: 'fixture',
    signal: controller.signal,
    onCode: () => {
      setImmediate(() => controller.abort());
    },
  });
  await expect(login).rejects.toMatchObject({ name: 'AbortError' });
  expect(http).toHaveBeenCalledOnce();
  await expect(selectedProfile('fixture')).rejects.toMatchObject({ code: 'login_required' });
});

for (const endpoint of ['/auth/device/code', '/auth/oauth2/token', '/v1/me']) {
  it(`cancels a stalled ${endpoint} request without saving a profile`, async () => {
    await isolate();
    const controller = new AbortController();
    const requested: string[] = [];
    const http = vi.fn<typeof fetch>(async (url, init) => {
      const pathname = new URL(String(url)).pathname;
      requested.push(pathname);
      if (pathname === endpoint) {
        const pending = new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
        });
        controller.abort();
        return pending;
      }
      if (pathname === '/auth/device/code') return Response.json(device);
      if (pathname === '/auth/oauth2/token') return Response.json(tokens);
      throw new Error(`Unexpected request: ${pathname}`);
    });
    vi.stubGlobal('fetch', http);
    await expect(
      deviceLogin({ origin, profile: 'fixture', signal: controller.signal, onCode: vi.fn() }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(requested.at(-1)).toBe(endpoint);
    await expect(selectedProfile('fixture')).rejects.toMatchObject({ code: 'login_required' });
  });
}

it('expires during the polling interval without sending a late token request', async () => {
  const http = vi.fn<typeof fetch>(async () => Response.json({ ...device, expires_in: 0.02 }));
  vi.stubGlobal('fetch', http);
  await expect(deviceLogin({ origin, profile: 'fixture', onCode: vi.fn() })).rejects.toMatchObject({
    code: 'device_code_expired',
  });
  expect(http).toHaveBeenCalledOnce();
});

it.each([0, -1, 1801])('rejects an invalid device lifetime %i before showing a code', async (expires_in) => {
  const show = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ ...device, expires_in })),
  );
  await expect(deviceLogin({ origin, profile: 'fixture', onCode: show })).rejects.toThrow();
  expect(show).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});
it('refuses a verification URL outside the trusted origin', async () => {
  const show = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ ...device, verification_uri_complete: 'https://attacker.invalid/device' }),
    ),
  );
  await expect(deviceLogin({ origin, profile: 'fixture', onCode: show })).rejects.toThrow(
    'outside the approved service origin',
  );
  expect(show).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});
it('does not save credentials when the device deadline expires during a token response', async () => {
  await isolate();
  const http = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/device/code')) return Response.json({ ...device, expires_in: 2 });
    if (String(url).endsWith('/token'))
      return new Promise<Response>((_, reject) => {
        const signal = init!.signal!;
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    throw new Error('Identity must not be requested after expiry');
  });
  vi.stubGlobal('fetch', http);
  await expect(deviceLogin({ origin, profile: 'fixture', onCode: vi.fn() })).rejects.toMatchObject({
    code: 'device_code_expired',
  });
  expect(http).toHaveBeenCalledTimes(2);
  await expect(selectedProfile('fixture')).rejects.toMatchObject({ code: 'login_required' });
});
