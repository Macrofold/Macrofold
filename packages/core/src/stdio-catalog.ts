import { z } from 'zod';
import { assert } from './errors';
const item = z.object({
  package: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-.][a-zA-Z0-9.-]+)?$/),
  label: z.string(),
  command: z.string().startsWith('/opt/platform/'),
  args: z.array(z.string()),
  environment_keys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).default([]),
  tools: z.array(
    z.object({ name: z.string(), description: z.string(), input_schema: z.record(z.string(), z.unknown()) }),
  ),
});
export type StdioCatalogItem = z.infer<typeof item>;
const pathField = { type: 'string', description: 'Absolute path within /workspace.' };
const defaults: StdioCatalogItem[] = [
  {
    package: '@modelcontextprotocol/server-filesystem',
    version: '2026.8.31',
    label: 'Filesystem · official MCP reference server',
    command: '/opt/platform/node_modules/.bin/mcp-server-filesystem',
    args: ['/workspace'],
    environment_keys: [],
    tools: [
      {
        name: 'read_text_file',
        description: 'Read a UTF-8 workspace file.',
        input_schema: {
          type: 'object',
          properties: { path: pathField },
          required: ['path'],
          additionalProperties: false,
        },
      },
      {
        name: 'write_file',
        description: 'Write a UTF-8 file in the current workspace. Replaces existing contents.',
        input_schema: {
          type: 'object',
          properties: { path: pathField, content: { type: 'string' } },
          required: ['path', 'content'],
          additionalProperties: false,
        },
      },
      {
        name: 'list_directory',
        description: 'List entries in a workspace directory.',
        input_schema: {
          type: 'object',
          properties: { path: pathField },
          required: ['path'],
          additionalProperties: false,
        },
      },
      {
        name: 'get_file_info',
        description: 'Read file metadata.',
        input_schema: {
          type: 'object',
          properties: { path: pathField },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ],
  },
];
export function stdioCatalog() {
  return z.array(item).parse(JSON.parse(process.env.MCP_STDIO_CATALOG_JSON || JSON.stringify(defaults)));
}
export function approvedStdio(packageName: unknown, version: unknown) {
  const entry = stdioCatalog().find((p) => p.package === packageName && p.version === version);
  assert(
    entry,
    400,
    'package_not_approved',
    'Select an exact package and version from the operator-approved catalog.',
  );
  assert(
    !entry.environment_keys.some((k) =>
      /^(PATH|HOME|NODE_|LD_|DYLD_|BASH|ENV$|SHELL$|PYTHON|PLATFORM_|VERCEL_)/.test(k),
    ),
    503,
    'invalid_stdio_catalog',
    'The operator must remove unsafe environment names from the package catalog.',
  );
  return entry;
}
