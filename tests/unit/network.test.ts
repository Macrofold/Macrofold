import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupAddress } from 'node:dns';
import * as undici from 'undici';
import { safeFetch } from '../../packages/providers/src/network';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn<() => Promise<LookupAddress[]>>() }));
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('undici', async (original) => ({
  ...(await original<typeof import('undici')>()),
  fetch: vi.fn(),
}));

beforeEach(() => {
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});
afterEach(() => vi.resetAllMocks());

describe('public network transport', () => {
  it('preserves conditional metadata responses without treating 304 as a redirect', async () => {
    const fetch = vi
      .mocked(undici.fetch)
      .mockResolvedValue(new undici.Response(null, { status: 304, headers: { etag: '"metadata-v1"' } }));
    const response = await safeFetch('https://desktop.example.test/client.json', {
      headers: { 'If-None-Match': '"metadata-v1"' },
    });
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
    expect(response.headers.get('etag')).toBe('"metadata-v1"');
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://desktop.example.test/client.json'),
      expect.objectContaining({
        headers: { 'If-None-Match': '"metadata-v1"' },
        redirect: 'manual',
      }),
    );
  });

  it.each([301, 302, 303, 307, 308])('rejects HTTP %i without following its destination', async (status) => {
    const fetch = vi
      .mocked(undici.fetch)
      .mockResolvedValue(
        new undici.Response(null, { status, headers: { location: 'https://127.0.0.1/internal' } }),
      );
    await expect(safeFetch('https://desktop.example.test/client.json')).rejects.toMatchObject({
      code: 'redirect_not_allowed',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['127.0.0.1', '169.254.169.254', '10.0.0.1', '::1', '::ffff:127.0.0.1'])(
    'rejects mixed public/private DNS answers containing %s before HTTP',
    async (address) => {
      lookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ]);
      const fetch = vi.mocked(undici.fetch);
      await expect(safeFetch('https://desktop.example.test/client.json')).rejects.toMatchObject({
        code: 'unsafe_url',
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
