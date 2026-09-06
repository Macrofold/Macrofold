import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import catalog from '../../../docs/api/admin-mcp.json';
import { identify, requireScopes } from './auth';
import { adminReport } from './reports';
import { config } from './config';
import { assert, errorBody } from './errors';
import { id } from './crypto';
import { pool } from '../../db';
import { boundedBody } from './body';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validators = new Map(catalog.tools.map((tool) => [tool.name, ajv.compile(tool.inputSchema)]));
export async function handleAdminMcp(request: Request) {
  const requestId = id();
  try {
    assert(request.method === 'POST', 405, 'method_not_allowed', 'This stateless MCP accepts POST requests.');
    assert(
      request.headers.get('authorization')?.startsWith('Bearer '),
      401,
      'unauthenticated',
      'The management MCP requires an operator OAuth token.',
    );
    assert(
      !request.headers.get('origin') || request.headers.get('origin') === config.origin,
      403,
      'forbidden',
      'This browser origin is not allowed.',
    );
    const p = await identify(request, `${config.origin}/admin/mcp`);
    const bytes = await boundedBody(request.body, 1024 * 1024);
    const server = new Server(
      { name: 'platform-operations', version: '0.1.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: catalog.tools
        .filter((tool) => tool.required_scopes.every((s) => p.scopes.includes(s)))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as { type: 'object'; properties: Record<string, unknown> },
          annotations: tool.annotations,
        })),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (call) => {
      const tool = catalog.tools.find((t) => t.name === call.params.name);
      let outcome = 'denied';
      try {
        assert(tool, 404, 'unknown_tool', 'Unknown management tool.');
        requireScopes(p, tool.required_scopes);
        const input = call.params.arguments || {};
        assert(
          validators.get(tool.name)!(input),
          400,
          'invalid_request',
          'Tool arguments do not match the documented input schema.',
        );
        const params: Record<string, string> = {},
          query = new URLSearchParams();
        for (const [key, value] of Object.entries(input)) {
          if (key === 'account_id' || key === 'run_id') params[key] = String(value);
          else query.set(key, String(value));
        }
        const result = await adminReport(tool.rest_operation_id, p, query, params);
        outcome = 'success';
        const output = JSON.parse(JSON.stringify(result));
        return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify(errorBody(error, requestId).body) }],
        };
      } finally {
        await pool.query('INSERT INTO admin_audit(id,operator_id,action,data) VALUES($1,$2,$3,$4)', [
          id(),
          p.id,
          `mcp:${call.params.name}`,
          JSON.stringify({ outcome, request_id: requestId }),
        ]);
      }
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(
        new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: bytes,
          signal: request.signal,
        }),
      );
    } finally {
      await server.close();
    }
  } catch (error) {
    const result = errorBody(error, requestId);
    return Response.json(result.body, {
      status: result.status,
      headers:
        result.status === 401
          ? {
              'WWW-Authenticate': `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource/admin/mcp"`,
            }
          : {},
    });
  }
}
