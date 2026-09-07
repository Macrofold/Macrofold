import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchProvider } from '../../packages/providers/src/search';
import { searchIdentity, searchKey, searchWeb } from '../../packages/core/src/search';
import { seal } from '../../packages/core/src/crypto';
import { searchFixtures } from '../fixtures/search';
import type { Document } from '../../packages/core/src/resources';
import * as network from '../../packages/providers/src/network';

const input = { query: 'docs & typescript', count: 2 };
const connection = (provider = 'exa', overrides: Record<string, unknown> = {}): Document => ({
  id: 'fixture',
  organization_id: 'fixture',
  created_at: '',
  revision: '1',
  kind: 'search',
  provider,
  auth_method: 'api_key',
  ...overrides,
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe.each(searchFixtures)('$provider search adapter', (fixture) => {
  it('sends the documented request with only its selected credential and normalizes results', async () => {
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(fixture.url);
      expect(init?.method || 'GET').toBe(fixture.body ? 'POST' : 'GET');
      const headers = new Headers(init?.headers);
      expect(headers.get(fixture.header)).toBe(fixture.credential);
      expect(headers.get('Accept')).toBe('application/json');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (fixture.body) {
        expect(headers.get('Content-Type')).toBe('application/json');
        expect(JSON.parse(String(init?.body))).toEqual(fixture.body);
      } else expect(init?.body).toBeUndefined();
      return Response.json(fixture.response([fixture.row, fixture.row, fixture.row]));
    });
    expect(await searchProvider(fixture.provider, transport).search(input, 'fixture-search-key')).toEqual([
      { title: 'Source', url: 'https://example.com', description: 'First\nSecond' },
      { title: 'Source', url: 'https://example.com', description: 'First\nSecond' },
    ]);
    expect(transport).toHaveBeenCalledOnce();
  });
  it('accepts an empty result set', async () => {
    const transport: typeof fetch = async () => Response.json(fixture.response([]));
    expect(await searchProvider(fixture.provider, transport).search(input, 'fixture-key')).toEqual([]);
  });
  it('handles missing optional titles/excerpts and discards unrelated content', async () => {
    const transport: typeof fetch = async () =>
      Response.json(
        fixture.response([{ url: 'https://example.com', title: null, raw_content: 'Do not expose this' }]),
      );
    expect(await searchProvider(fixture.provider, transport).search(input, 'fixture-key')).toEqual([
      { title: 'https://example.com', url: 'https://example.com', description: '' },
    ]);
  });
  it('rejects malformed results without echoing upstream content', async () => {
    const transport: typeof fetch = async () =>
      Response.json(fixture.response([{ ...fixture.row, url: 42, secret: 'upstream-secret' }]));
    await expect(
      searchProvider(fixture.provider, transport).search(input, 'fixture-key'),
    ).rejects.toMatchObject({ code: 'search_invalid_response', status: 502 });
  });
  it('uses the encrypted customer key even when a managed Brave key exists', () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'must-never-use');
    expect(searchKey(connection(fixture.provider, { secret_ciphertext: seal('customer-key') }))).toBe(
      'customer-key',
    );
    expect(() => searchKey(connection(fixture.provider))).toThrow(
      expect.objectContaining({ code: 'search_not_configured' }),
    );
  });
});

it.each([401, 403, 429, 500])(
  'does not retry a provider HTTP %s or expose its error body',
  async (status) => {
    let cancelled = false;
    const transport = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status },
        ),
    );
    await expect(searchProvider('exa', transport).search(input, 'key')).rejects.toMatchObject({
      code: 'search_failed',
      status: 502,
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(cancelled).toBe(true);
  },
);
it('does not retry or leak network error details', async () => {
  const transport = vi.fn<typeof fetch>(async () => {
    throw new Error('credential-or-query-secret');
  });
  await expect(searchProvider('exa', transport).search(input, 'key')).rejects.toThrow(
    'The search provider could not be reached. It may have consumed provider credits.',
  );
  expect(transport).toHaveBeenCalledOnce();
});
it('honors cancellation before dispatch without consuming a call', async () => {
  const transport = vi.fn<typeof fetch>();
  await expect(
    searchProvider('exa', transport).search(input, 'key', AbortSignal.abort()),
  ).rejects.toMatchObject({ code: 'search_timeout' });
  expect(transport).not.toHaveBeenCalled();
});
it.each(['brave', 'exa'] as const)(
  'bounds %s calls with an aborting timeout without retry',
  async (provider) => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const transport = vi.fn<typeof fetch>(async (_url, init) => {
      controller.abort();
      init!.signal!.throwIfAborted();
      throw new Error('unreachable');
    });
    await expect(searchProvider(provider, transport).search(input, 'key')).rejects.toMatchObject({
      status: 504,
      code: 'search_timeout',
    });
    expect(timeout).toHaveBeenCalledWith(provider === 'brave' ? 15000 : 30000);
    expect(transport).toHaveBeenCalledOnce();
  },
);
it.each([
  ['invalid JSON', 'not-json', 'upstream_invalid_json'],
  ['oversized body', 'x'.repeat(2 * 1024 * 1024 + 1), 'body_too_large'],
] as const)('rejects %s', async (_name, body, code) => {
  const transport: typeof fetch = async () => new Response(body);
  await expect(searchProvider('exa', transport).search(input, 'key')).rejects.toMatchObject({ code });
});
it('rejects a Firecrawl success=false envelope even on HTTP 200', async () => {
  const transport: typeof fetch = async () => Response.json({ success: false, error: 'sensitive' });
  await expect(searchProvider('firecrawl', transport).search(input, 'key')).rejects.toMatchObject({
    code: 'search_invalid_response',
  });
});
it('accepts Brave responses without a web section', async () => {
  expect(
    await searchProvider('brave', async () => Response.json({ type: 'search' })).search(input, 'key'),
  ).toEqual([]);
});
it('bounds excerpts and rejects unsafe or credential-bearing source URLs', async () => {
  const transport: typeof fetch = async () =>
    Response.json({
      results: [{ title: 'Source', url: 'https://example.com', highlights: ['x'.repeat(5000)] }],
    });
  expect((await searchProvider('exa', transport).search(input, 'key'))[0].description).toHaveLength(4000);
  for (const url of ['not-a-url', 'javascript:alert(1)', 'https://user:secret@example.com']) {
    await expect(
      searchProvider('exa', async () => Response.json({ results: [{ url }] })).search(input, 'key'),
    ).rejects.toMatchObject({ code: 'search_invalid_response' });
  }
});
it.each(['exa', 'tavily', 'parallel', 'firecrawl'])(
  'rejects managed %s instead of using a platform key',
  (provider) => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'must-never-use');
    expect(() => searchKey(connection(provider, { auth_method: 'none' }))).toThrow(
      expect.objectContaining({ code: 'invalid_search_connection' }),
    );
  },
);
it.each(['constructor', '__proto__', 'unknown', undefined])('rejects unsupported provider %s', (provider) => {
  expect(() => searchIdentity({ provider, auth_method: 'api_key' })).toThrow(
    expect.objectContaining({ code: 'invalid_search_connection' }),
  );
});
it('keeps managed Brave credentials explicit and rejects empty BYOK credentials', () => {
  vi.stubEnv('BRAVE_SEARCH_API_KEY', 'managed-fixture');
  expect(searchKey(connection('brave', { auth_method: 'none' }))).toBe('managed-fixture');
  vi.stubEnv('BRAVE_SEARCH_API_KEY', '');
  expect(() => searchKey(connection('brave', { auth_method: 'none' }))).toThrow(
    expect.objectContaining({ code: 'search_not_configured' }),
  );
  expect(() => searchKey(connection('exa', { secret_ciphertext: seal('  ') }))).toThrow(
    expect.objectContaining({ code: 'search_not_configured' }),
  );
});
it.each([
  {},
  { query: '' },
  { query: 'x'.repeat(401) },
  { query: 'ok', count: 0 },
  { query: 'ok', count: 11 },
  { query: 'ok', count: 1.5 },
  { query: 'ok', type: 'deep' },
])('rejects invalid tool arguments before sending a request: %j', async (args) => {
  const fetch = vi.spyOn(network, 'safeFetch').mockRejectedValue(new Error('outbound denied'));
  await expect(searchWeb(connection(), args)).rejects.toMatchObject({ code: 'invalid_tool_arguments' });
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps the web_search result contract and defaults to five results', async () => {
  const fetch = vi.spyOn(network, 'safeFetch').mockImplementation(async (_url, init) => {
    expect(JSON.parse(String(init?.body)).numResults).toBe(5);
    return Response.json({ results: [] });
  });
  expect(
    await searchWeb(connection('exa', { secret_ciphertext: seal('fixture-key') }), { query: 'query' }),
  ).toEqual({ content: [{ type: 'text', text: '{"query":"query","results":[]}' }] });
  expect(fetch).toHaveBeenCalledOnce();
});
