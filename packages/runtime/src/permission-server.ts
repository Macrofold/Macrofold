import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { z } from 'zod';
import type { PermissionLayers } from '../../contracts/permissions';
import { permissionFileDefinition, fileToolName, permissionFileTools } from './permission-files';

/** Loopback transport for harnesses with MCP extension points. The policy and
 * serialized filesystem implementation remain shared with in-process tools.
 * It has no arbitrary command/resource/proxy endpoint and no vendor credential. */
export async function startPermissionFileServer(root: string, layers: PermissionLayers) {
  const [{ Server }, { StreamableHTTPServerTransport }, { CallToolRequestSchema, ListToolsRequestSchema }] =
    await Promise.all([
      import('@modelcontextprotocol/sdk/server/index.js'),
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
      import('@modelcontextprotocol/sdk/types.js'),
    ]);
  const execute = permissionFileTools(root, layers);
  const definition = permissionFileDefinition(layers);
  const token = randomBytes(32).toString('hex');
  const connections = new Set<Server>();
  const http = createServer((req, res) => {
    if (req.url !== '/mcp' || req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(403).end();
      return;
    }
    void (async () => {
      const server = new Server({ name: 'worktree', version: '1.0.0' }, { capabilities: { tools: {} } });
      connections.add(server);
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: definition
          ? [
              {
                name: fileToolName,
                description: definition.description,
                inputSchema: { ...z.toJSONSchema(definition.schema), type: 'object' as const },
              },
            ]
          : [],
      }));
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        try {
          if (request.params.name !== fileToolName) throw new Error('Unknown file tool.');
          return { content: [{ type: 'text' as const, text: await execute(request.params.arguments) }] };
        } catch (error) {
          return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] };
        }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.once('close', () => {
        connections.delete(server);
        void server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('File tool listener unavailable.');
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    async close() {
      await Promise.allSettled([...connections].map((server) => server.close()));
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
