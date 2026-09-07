import { afterEach, expect, it, vi } from 'vitest';
import { composio } from '../../packages/core/src/connections';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([undefined, '', '   ', 'ak_******', 'ak_...1234', 'ak_…1234'])(
  'rejects an absent or masked Composio credential before requesting an upstream operation (%s)',
  (key) => {
    vi.stubEnv('COMPOSIO_API_KEY', key);
    expect(composio).toThrow(expect.objectContaining({ code: 'integration_not_configured', status: 503 }));
  },
);

it('accepts an unmasked configured value without assuming that construction verifies authentication', () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-not-a-real-project-key');
  vi.stubEnv('COMPOSIO_TOOLKIT_VERSIONS_JSON', '{}');
  expect(composio).not.toThrow();
});

it('maps pinned execution, caller identity and the observed log_id response through the real SDK', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-not-a-real-project-key');
  vi.stubEnv('COMPOSIO_TOOLKIT_VERSIONS_JSON', '{"hackernews":"20260708_00"}');
  const http = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (init?.method === 'GET') {
      expect(String(url)).toBe(
        'https://backend.composio.dev/api/v3.1/tools/HACKERNEWS_GET_ITEM?version=20260708_00',
      );
      return Response.json({
        name: 'Get Item',
        slug: 'HACKERNEWS_GET_ITEM',
        description: 'Public fixture',
        toolkit: { slug: 'hackernews', name: 'Hacker News', logo: '' },
        version: '20260708_00',
        available_versions: ['20260708_00'],
        input_parameters: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
        output_parameters: { type: 'object' },
        tags: [],
        no_auth: true,
      });
    }
    expect(String(url)).toBe('https://backend.composio.dev/api/v3.1/tools/execute/HACKERNEWS_GET_ITEM');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('fixture-not-a-real-project-key');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      user_id: 'fixture-org:fixture-user',
      version: '20260708_00',
      arguments: { id: 8863 },
    });
    return Response.json({
      data: { id: 8863, type: 'story' },
      successful: true,
      error: null,
      log_id: 'fixture-log',
    });
  });
  const sdk = composio();
  sdk.getClient().maxRetries = 0;
  const result = await sdk.tools.execute('HACKERNEWS_GET_ITEM', {
    userId: 'fixture-org:fixture-user',
    version: '20260708_00',
    arguments: { id: 8863 },
  });
  expect(result).toMatchObject({ successful: true, data: { id: 8863, type: 'story' }, logId: 'fixture-log' });
  expect(http).toHaveBeenCalledTimes(2);
});
