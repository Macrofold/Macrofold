import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { NativeConfiguration } from './types';

/** Pi custom tools use the same authorized MCP broker as the other harnesses. */
export async function piBrokerTools(c: NativeConfiguration, signal: AbortSignal) {
  const tools: ToolDefinition[] = [];
  if (!c.toolGrants) return { tools, close: async () => {} };
  const client = new Client({ name: 'native-runtime', version: '0.1.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(c.toolURL), {
        requestInit: { headers: { Authorization: `Bearer ${c.token}` }, signal },
      }),
    );
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor }, { signal });
      for (const tool of page.tools)
        tools.push({
          name: tool.name,
          label: tool.name,
          description: tool.description || tool.name,
          parameters: tool.inputSchema as ToolDefinition['parameters'],
          execute: async (_id, args, callSignal) => {
            const result = await client.callTool(
              { name: tool.name, arguments: args as Record<string, unknown> },
              undefined,
              {
                signal: callSignal ? AbortSignal.any([signal, callSignal]) : signal,
              },
            );
            if (result.isError)
              throw new Error(`MCP tool ${tool.name} failed: ${JSON.stringify(result.content)}`);
            // The broker returns JSON/text. Keep unsupported media outside this text runtime.
            return { content: [{ type: 'text', text: JSON.stringify(result) }], details: {} };
          },
        });
      cursor = page.nextCursor;
    } while (cursor);
    return { tools, close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}
