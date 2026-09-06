import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ listMcp: vi.fn(), listComposio: vi.fn(), close: vi.fn(async () => {}) }));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = vi.fn();
    close = fixture.close;
    listTools = fixture.listMcp;
  },
}));
vi.mock('@composio/core', () => ({
  Composio: class {
    getConfig = () => ({ toolkitVersions: { github: 'reviewed-version' } });
    getClient = () => ({ tools: { list: fixture.listComposio } });
  },
}));
// Discovery mapping does not need identity/database startup; OAuth and real
// grant transactions have their own integration coverage.
vi.mock('../../packages/core/src/resources', () => ({}));
vi.mock('../../packages/core/src/mcp-oauth', () => ({
  withConnectionOAuth: () => {
    throw new Error('OAuth is outside this discovery fixture');
  },
}));
import { connectionTools } from '../../packages/core/src/connections';
const connection = {
  id: 'fixture',
  organization_id: 'fixture',
  revision: '1',
  created_at: '',
  auth_method: 'none',
  grants: { tools: ['second'] },
};
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
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
