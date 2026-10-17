import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ listMcp: vi.fn(), listComposio: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn();
    setNotificationHandler = vi.fn();
    close = fixture.close;
    listTools = fixture.listMcp;
  },
}));
vi.mock('@composio/core', () => ({
  Composio: class {
    getClient = () => ({ tools: { list: fixture.listComposio } });
  },
}));
// Discovery mapping does not need identity/database startup; OAuth and real
// grant transactions have their own integration coverage.
vi.mock('../../packages/core/src/connector-enablement', () => ({
  enabledConnector: async (toolkit: string) => ({
    toolkit,
    toolkit_version: 'reviewed-version',
    auth_config_id: 'fixture-auth',
    enabled: true,
    creation_pending: false,
  }),
}));
vi.mock('../../packages/core/src/resources', () => ({}));
vi.mock('../../packages/core/src/mcp-oauth', () => ({
  withConnectionOAuth: () => {
    throw new Error('OAuth is outside this discovery fixture');
  },
}));
import { connectionTools } from '../../packages/core/src/connections';
import {
  connectionToolCatalog,
  ConnectionToolCatalog,
} from '../../packages/core/src/connection-tool-catalog';
const connection = {
  id: 'fixture',
  organization_id: 'fixture',
  revision: '1',
  created_at: '',
  name: 'Fixture',
  status: 'healthy' as const,
  auth_method: 'none',
  access_version: '1',
  access_organization_wide: true,
  access_tools: ['second'],
};
afterEach(() => {
  connectionToolCatalog.invalidate();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it('reuses raw schema objects while projecting current grants and invalidating credential revisions', async () => {
  fixture.listMcp.mockResolvedValue({ tools: [{ name: 'second', inputSchema: { type: 'object' } }] });
  const selected = { ...connection, kind: 'mcp_remote' as const, url: 'https://example.test/mcp' };
  const first = await connectionTools(selected);
  const revoked = await connectionTools({ ...selected, access_tools: [] });
  expect(revoked[0].granted).toBe(false);
  expect(revoked[0].input_schema).toBe(first[0].input_schema);
  expect(fixture.listMcp).toHaveBeenCalledOnce();
  await connectionTools({ ...selected, revision: '2' });
  expect(fixture.listMcp).toHaveBeenCalledTimes(2);
  await connectionTools(selected, { refresh: true });
  expect(fixture.listMcp).toHaveBeenCalledTimes(3);
});

it('single-flights cold discovery and bounds entries, expiry and failed loads', async () => {
  let now = 0;
  const cache = new ConnectionToolCatalog({ entries: 1, bytes: 1024, pending: 1, ttlMs: 10 }, () => now);
  let complete!: (tools: { name: string; input_schema: { type: string } }[]) => void;
  const load = vi.fn(
    () =>
      new Promise<{ name: string; input_schema: { type: string } }[]>((resolve) => {
        complete = resolve;
      }),
  );
  const a = cache.read('first', load);
  const b = cache.read('first', load);
  await expect(cache.read('second', load)).rejects.toMatchObject({ code: 'tool_catalog_busy' });
  await Promise.resolve();
  complete([{ name: 'fixture', input_schema: { type: 'object' } }]);
  expect(await b).toBe(await a);
  expect(load).toHaveBeenCalledOnce();
  const discover = vi.fn(async () => [{ name: 'fresh', input_schema: { type: 'object' } }]);
  await cache.read('second', discover);
  await cache.read('first', discover);
  expect(discover).toHaveBeenCalledTimes(2);
  now = 11;
  await cache.read('first', discover);
  expect(discover).toHaveBeenCalledTimes(3);
  const failed = vi.fn(async () => {
    throw new Error('discovery failed');
  });
  await expect(cache.read('error', failed)).rejects.toThrow('discovery failed');
  await expect(cache.read('error', failed)).rejects.toThrow('discovery failed');
  expect(failed).toHaveBeenCalledTimes(2);
});
it('discovers and preserves approved tools on later MCP pages', async () => {
  fixture.listMcp
    .mockResolvedValueOnce({
      tools: [{ name: 'first', inputSchema: { type: 'object' } }],
      nextCursor: 'page-2',
    })
    .mockResolvedValueOnce({ tools: [{ name: 'second', inputSchema: { type: 'object' } }] });
  const tools = await connectionTools({ ...connection, kind: 'mcp_remote', url: 'https://example.test/mcp' });
  expect(tools.map(({ name, granted }) => ({ name, granted }))).toEqual([
    { name: 'first', granted: false },
    { name: 'second', granted: true },
  ]);
  expect(fixture.listMcp.mock.calls[1][0]).toEqual({ cursor: 'page-2' });
  expect(fixture.close).toHaveBeenCalledOnce();
});

it('uses paginated Composio discovery with the configured toolkit version and raw API schema', async () => {
  vi.stubEnv('COMPOSIO_API_KEY', 'fixture-not-a-real-key');
  fixture.listComposio
    .mockResolvedValueOnce({
      items: [{ slug: 'first', input_parameters: { type: 'object' } }],
      next_cursor: 'page-2',
    })
    .mockResolvedValueOnce({
      items: [{ slug: 'second', input_parameters: { type: 'object', required: ['message'] } }],
    });
  const tools = await connectionTools({ ...connection, kind: 'composio', provider: 'github' });
  expect(tools[1]).toMatchObject({ name: 'second', granted: true, input_schema: { required: ['message'] } });
  expect(fixture.listComposio.mock.calls[1][0]).toEqual({
    toolkit_slug: 'github',
    toolkit_versions: { github: 'reviewed-version' },
    limit: 100,
    cursor: 'page-2',
  });
});

it('closes an MCP session when a later discovery page fails', async () => {
  fixture.listMcp
    .mockResolvedValueOnce({
      tools: [{ name: 'first', inputSchema: { type: 'object' } }],
      nextCursor: 'page-2',
    })
    .mockRejectedValueOnce(new Error('unavailable'));
  await expect(
    connectionTools({ ...connection, kind: 'mcp_remote', url: 'https://example.test/mcp' }),
  ).rejects.toThrow('unavailable');
  expect(fixture.close).toHaveBeenCalledOnce();
});
