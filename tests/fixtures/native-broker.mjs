// Runs only inside the network-disabled native image; uses the same MCP library as the broker.
import { Server } from '/opt/platform/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StreamableHTTPServerTransport } from '/opt/platform/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '/opt/platform/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import assert from 'node:assert/strict';

export function nativeBroker(expectedToken = () => 'fixture-local-only') {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async handle(req, res) {
      assert.equal(req.headers.authorization, `Bearer ${expectedToken()}`);
      const server = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: 'fixture_echo',
            description: 'Echo the fixture note.',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          },
        ],
      }));
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        assert.equal(request.params.name, 'fixture_echo');
        assert.deepEqual(request.params.arguments, { text: 'broker verified' });
        calls++;
        return { content: [{ type: 'text', text: 'broker verified' }] };
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      res.on('close', () => {
        void server.close();
      });
      await transport.handleRequest(req, res);
    },
  };
}
