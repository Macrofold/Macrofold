import { createServer, type IncomingMessage } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CustomerNotes } from './data';

/** verifyBearer must validate signature/expiry/audience or resolve an opaque token hash from
 * your store. The returned customer ID is authority; tool arguments never choose a customer. */
export function customerDataServer(
  readNotes: CustomerNotes,
  verifyBearer: (token: string) => Promise<string | undefined>,
) {
  return createServer(async (request: IncomingMessage, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }
    // This is a server-to-server API. Browser callers are not supported by this recipe.
    if (request.headers.origin) {
      response.writeHead(403).end();
      return;
    }
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.authorization || '');
    let customer: string | undefined;
    try {
      customer = match ? await verifyBearer(match[1]) : undefined;
    } catch {
      /* Fail closed. */
    }
    if (!customer) {
      response.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    const server = new McpServer({ name: 'customer-notes', version: '1.0.0' });
    // A fresh server/transport per request avoids carrying Alice's closures into Bob's session.
    server.registerTool(
      'read_customer_notes',
      {
        description: 'Read up to 20 notes belonging to the connected customer.',
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        try {
          return { content: [{ type: 'text', text: JSON.stringify(await readNotes(customer)) }] };
        } catch {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Notes could not be read. Check the connection and retry.' }],
          };
        }
      },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.once('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch {
      if (!response.headersSent) response.writeHead(500).end();
      else response.end();
    }
  });
}
