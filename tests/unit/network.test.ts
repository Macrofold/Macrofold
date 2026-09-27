import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupAddress } from 'node:dns';
import * as undici from 'undici';
import { config } from '../../packages/core/src/config';
import { safeFetch, mcpFetch, validateMcpURL } from '../../packages/providers/src/network';

const originalConfig = { mode: config.mode, origin: config.origin };
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

describe('local MCP destination policy', () => {
  beforeEach(() => {
    vi.stubEnv('LOCAL_MCP_ALLOWED_ORIGINS', 'http://localhost:59620');
    vi.stubEnv('VERCEL_ENV', '');
    config.mode = 'local';
    config.origin = 'http://localhost:3210';
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    config.mode = originalConfig.mode;
    config.origin = originalConfig.origin;
  });

  it('accepts exact local origins for MCP while keeping public transport restricted', async () => {
    const fetch = vi.mocked(undici.fetch).mockResolvedValue(new undici.Response(null, { status: 204 }));
    expect((await mcpFetch('http://localhost:59620/mcp')).status).toBe(204);
    await expect(safeFetch('http://localhost:59620/mcp')).rejects.toMatchObject({ code: 'unsafe_url' });
    await expect(mcpFetch('http://localhost:59621/mcp')).rejects.toMatchObject({ code: 'unsafe_url' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.2', '192.168.1.2', 'fd00::1'])(
    'accepts explicitly allowed private/loopback resolution %s',
    async (address) => {
      lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
      expect((await validateMcpURL('http://localhost:59620/mcp')).addresses[0].address).toBe(address);
    },
  );

  it.each(['169.254.169.254', 'fe80::1', '0.0.0.0', '224.0.0.1', '93.184.216.34'])(
    'rejects local DNS answers containing %s',
    async (address) => {
      lookup.mockResolvedValue([
        { address: '127.0.0.1', family: 4 },
        { address, family: address.includes(':') ? 6 : 4 },
      ]);
      await expect(mcpFetch('http://localhost:59620/mcp')).rejects.toMatchObject({ code: 'unsafe_url' });
      expect(undici.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['production', 'vercel', 'nonlocal-origin', 'empty-list'])(
    'ignores local exceptions under %s',
    async (gate) => {
      if (gate === 'production') config.mode = 'production';
      if (gate === 'vercel') vi.stubEnv('VERCEL_ENV', 'preview');
      if (gate === 'nonlocal-origin') config.origin = 'https://app.example.test';
      if (gate === 'empty-list') vi.stubEnv('LOCAL_MCP_ALLOWED_ORIGINS', '');
      await expect(mcpFetch('http://localhost:59620/mcp')).rejects.toMatchObject({ code: 'unsafe_url' });
      expect(undici.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    '*',
    'file:///tmp',
    'http://*.example.test',
    'http://user:secret@localhost:59620',
    'http://localhost:59620/mcp',
    'http://localhost:59620?x=1',
    'http://localhost:59620#x',
  ])('fails closed on invalid allowlist entry %s', async (entry) => {
    vi.stubEnv('LOCAL_MCP_ALLOWED_ORIGINS', entry);
    await expect(mcpFetch('http://localhost:59620/mcp')).rejects.toMatchObject({
      code: 'invalid_local_mcp_origins',
    });
    expect(undici.fetch).not.toHaveBeenCalled();
  });

  it('normalizes comma-separated origins but rejects embedded request credentials', async () => {
    vi.stubEnv('LOCAL_MCP_ALLOWED_ORIGINS', ' http://localhost:59620/, http://127.0.0.1:59620 ');
    await expect(validateMcpURL('http://127.0.0.1:59620/mcp')).resolves.toBeDefined();
    await expect(mcpFetch('http://user:secret@localhost:59620/mcp')).rejects.toMatchObject({
      code: 'unsafe_url',
    });
  });

  it('preserves public HTTPS MCP access and rejects redirects from local endpoints', async () => {
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(validateMcpURL('https://mcp.example.test/mcp')).resolves.toBeDefined();
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    vi.mocked(undici.fetch).mockResolvedValue(
      new undici.Response(null, { status: 302, headers: { location: 'http://localhost:59620/other' } }),
    );
    await expect(mcpFetch('http://localhost:59620/mcp')).rejects.toMatchObject({
      code: 'redirect_not_allowed',
    });
    expect(undici.fetch).toHaveBeenCalledTimes(1);
  });
});
