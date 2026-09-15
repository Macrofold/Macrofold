import { afterEach, expect, it, vi } from 'vitest';
import { piBrokerTools } from '../../packages/runtime/src/pi-tools';
import type { NativeConfiguration } from '../../packages/runtime/src/types';

const mcp = vi.hoisted(() => ({
  connect: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  transport: vi.fn(),
}));
vi.mock('../../packages/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js', () => ({
  Client: class {
    connect = mcp.connect;
    listTools = mcp.listTools;
    callTool = mcp.callTool;
    close = mcp.close;
  },
}));
vi.mock(
  '../../packages/runtime/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js',
  () => ({
    StreamableHTTPClientTransport: class {
      constructor(...args: unknown[]) {
        mcp.transport(...args);
      }
    },
  }),
);
afterEach(() => vi.resetAllMocks());
const config = {
  toolGrants: true,
  toolURL: 'https://fixture.invalid/runtime/tools',
  token: 'run-capability',
} as NativeConfiguration;
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] };
it('does not connect without admitted tool grants', async () => {
  const broker = await piBrokerTools({ ...config, toolGrants: false }, new AbortController().signal);
  expect(broker.tools).toEqual([]);
  await broker.close();
  expect(mcp.connect).not.toHaveBeenCalled();
});
it('paginates authorized tools, sends only the run capability, and propagates cancellation', async () => {
  mcp.listTools
    .mockResolvedValueOnce({ tools: [{ name: 'first', inputSchema: schema }], nextCursor: 'next' })
    .mockResolvedValueOnce({ tools: [{ name: 'second', description: 'Second tool', inputSchema: schema }] });
  mcp.callTool.mockResolvedValue({ content: [{ type: 'text', text: 'Done' }] });
  const controller = new AbortController();
  const broker = await piBrokerTools(config, controller.signal);
  expect(broker.tools.map((tool) => tool.name)).toEqual(['first', 'second']);
  expect(mcp.listTools.mock.calls[1][0]).toEqual({ cursor: 'next' });
  expect(mcp.transport).toHaveBeenCalledWith(new URL(config.toolURL), {
    requestInit: { headers: { Authorization: 'Bearer run-capability' }, signal: controller.signal },
  });
  const call = new AbortController();
  const result = await broker.tools[1].execute(
    'native-id',
    { text: 'Note' },
    call.signal,
    undefined,
    {} as never,
  );
  expect(result.content).toEqual([
    { type: 'text', text: JSON.stringify({ content: [{ type: 'text', text: 'Done' }] }) },
  ]);
  expect(mcp.callTool.mock.calls[0][0]).toEqual({ name: 'second', arguments: { text: 'Note' } });
  controller.abort();
  expect(mcp.callTool.mock.calls[0][2].signal.aborted).toBe(true);
  await broker.close();
  expect(mcp.close).toHaveBeenCalledTimes(1);
});
it('surfaces MCP tool failures to the native agent instead of reporting success', async () => {
  mcp.listTools.mockResolvedValue({ tools: [{ name: 'denied', inputSchema: schema }] });
  mcp.callTool.mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'Grant revoked' }] });
  const broker = await piBrokerTools(config, new AbortController().signal);
  await expect(broker.tools[0].execute('id', {}, undefined, undefined, {} as never)).rejects.toThrow(
    'Grant revoked',
  );
  await broker.close();
});
it('cleans up if discovery loses authentication', async () => {
  mcp.listTools.mockRejectedValue(new Error('Unauthorized'));
  await expect(piBrokerTools(config, new AbortController().signal)).rejects.toThrow('Unauthorized');
  expect(mcp.close).toHaveBeenCalledTimes(1);
});
