import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { identify } from './auth';
import { boundedBody } from './body';
import { config } from './config';
import { id } from './crypto';
import { assert, errorBody } from './errors';
import { handleApi } from './http';
import { customerMcpCatalog, customerMcpInstructions, mcpApiRequest } from './customer-mcp-catalog';

/** Stateless Streamable HTTP; all domain policy and auditing stay in the REST application pipeline. */
export async function handleCustomerMcp(request: Request, onMutation?: () => void) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  try {
    assert(
      !request.headers.get('origin') || request.headers.get('origin') === config.origin,
      403,
      'forbidden',
      'This browser origin is not allowed.',
    );
    assert(
      request.headers.get('authorization')?.match(/^Bearer\s+\S+$/i),
      401,
      'unauthenticated',
      'Connect with OAuth or a scoped Macrofold API key.',
    );
    // Discovery must work before a multi-organization user selects a membership.
    const p = await identify(
      new Request(`${config.origin}/v1/me`, { headers: request.headers }),
      `${config.origin}/mcp`,
    );
    if (request.method !== 'POST')
      return new Response(null, { status: 405, headers: { ...Object.fromEntries(headers), Allow: 'POST' } });
    const bytes = await boundedBody(request.body, 1024 * 1024);
    const server = new Server(
      { name: 'macrofold', version: '0.1.0' },
      {
        capabilities: { tools: {} },
        instructions: customerMcpInstructions,
      },
    );
    server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => {
      const cursor = params?.cursor || '0';
      assert(
        /^(0|[1-9]\d*)$/.test(cursor) && Number.isSafeInteger(Number(cursor)),
        400,
        'invalid_cursor',
        'Use the nextCursor returned by tools/list.',
      );
      const available = customerMcpCatalog.filter((entry) =>
        entry.scopes.every((scope) => p.scopes.includes(scope)),
      );
      const offset = Number(cursor);
      assert(offset <= available.length, 400, 'invalid_cursor', 'Tool cursor is out of range.');
      return {
        tools: available.slice(offset, offset + 50).map((entry) => entry.tool),
        ...(offset + 50 < available.length ? { nextCursor: String(offset + 50) } : {}),
      };
    });
    server.setRequestHandler(CallToolRequestSchema, async ({ params }): Promise<CallToolResult> => {
      try {
        const entry = customerMcpCatalog.find((item) => item.tool.name === params.name);
        assert(entry, 404, 'unknown_tool', 'Unknown customer API tool. Use tools/list.');
        const response = await handleApi(
          mcpApiRequest(entry, params.arguments || {}, request, config.origin),
          'mcp',
        );
        // Hosting owns dispatch scheduling; discovery/read calls must never trigger it.
        if (response.ok && !entry.tool.annotations?.readOnlyHint) onMutation?.();
        let data: unknown;
        const download = response.status === 302 && response.headers.get('location');
        if (download) data = { download_url: download };
        else if (response.headers.get('content-type')?.includes('application/json'))
          data = JSON.parse((await boundedBody(response.body, 1024 * 1024)).toString());
        else if (response.status === 204) data = null;
        else {
          const content = await boundedBody(response.body, 64 * 1024);
          // Lossless small-file reads; never inject user HTML as an MCP app/resource.
          let text: string | undefined;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(content);
          } catch {
            /* binary */
          }
          data = {
            content: text ?? content.toString('base64'),
            encoding: text === undefined ? 'base64' : 'utf8',
            byte_size: content.length,
            revision: response.headers.get('etag'),
          };
        }
        const output = {
          status: response.status,
          data,
          request_id: response.headers.get('x-request-id'),
          ...(response.headers.has('retry-after')
            ? { retry_after_seconds: Number(response.headers.get('retry-after')) }
            : {}),
        };
        return {
          isError: !response.ok && !download,
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        const result = errorBody(error, id());
        const output = { status: result.status, data: result.body };
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const response = await transport.handleRequest(
        new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: bytes,
          signal: request.signal,
        }),
      );
      for (const [key, value] of headers) response.headers.set(key, value);
      return response;
    } finally {
      await server.close();
    }
  } catch (error) {
    const result = errorBody(error, id());
    if (result.status === 401)
      headers.set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/mcp"`,
      );
    return Response.json(result.body, { status: result.status, headers });
  }
}
