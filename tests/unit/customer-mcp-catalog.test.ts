import { describe, expect, it } from 'vitest';
import {
  customerMcpCatalog,
  mcpApiRequest,
  mcpExcludedOperations,
} from '../../packages/core/src/customer-mcp-catalog';
import { routes } from '../../packages/core/src/http-contract';

const origin = 'https://agents.example.test';
const incoming = new Request(`${origin}/mcp`, {
  headers: {
    authorization: 'Bearer fixture-only',
    cookie: 'never-forward=this',
    'x-organization-id': '019e1700-0000-7000-8000-000000000001',
  },
});
const entry = (name: string) => customerMcpCatalog.find((e) => e.tool.name === name)!;
const uuid = '019e1700-0000-7000-8000-000000000002';
describe('customer MCP contract adapter', () => {
  it('covers every customer operation, with explicit alternatives for streaming, and no operator tools', () => {
    const expected = routes
      .filter((r) => r.path.startsWith('/v1/'))
      .map((r) => r.operation.operationId)
      .sort();
    expect(
      [...customerMcpCatalog.map((e) => e.tool.name), ...Object.keys(mcpExcludedOperations)].sort(),
    ).toEqual(expected);
    expect(new Set(customerMcpCatalog.map((e) => e.tool.name)).size).toBe(customerMcpCatalog.length);
    for (const item of customerMcpCatalog) {
      // getOperation authorizes the stored operation's own resource/scope.
      if (item.tool.name !== 'getOperation') expect(item.scopes.length).toBeGreaterThan(0);
      expect(item.tool.description).toContain(item.route.path);
      expect(item.tool.inputSchema.additionalProperties).toBe(false);
      expect(item.tool.annotations?.destructiveHint).toBe(!item.tool.annotations?.readOnlyHint);
    }
  });
  it('carries reachable definitions and required body fields without accepting unknown properties', () => {
    const create = entry('createRun');
    const input = {
      idempotency_key: 'fixture-create',
      body: {
        workspace_id: uuid,
        prompt: 'Do the task',
        harness: 'codex',
        model: 'fixture-model',
        billing_mode: 'managed',
      },
    };
    expect(create.validate(input), JSON.stringify(create.validate.errors)).toBe(true);
    expect(create.validate({ ...input, body: { ...input.body, unrecognized: 'no' } })).toBe(false);
    expect(create.validate({ ...input, body: { workspace_id: uuid } })).toBe(false);
    expect(create.validate({ ...input, url: 'https://attacker.invalid' })).toBe(false);
    expect(create.validate({ body: input.body })).toBe(false);
  });
  it('maps path, query and permitted headers without forwarding cookies or arbitrary headers', async () => {
    const request = mcpApiRequest(
      entry('writeFile'),
      {
        worktree_id: uuid,
        path: 'notes/my note.md',
        if_match: '"3"',
        idempotency_key: 'fixture-write',
        body: '# Hello',
      },
      incoming,
      origin,
    );
    expect(request.method).toBe('PUT');
    expect(new URL(request.url).pathname).toBe(`/v1/worktrees/${uuid}/file`);
    expect(new URL(request.url).searchParams.get('path')).toBe('notes/my note.md');
    expect(request.headers.get('if-match')).toBe('"3"');
    expect(request.headers.get('cookie')).toBeNull();
    expect(request.headers.get('authorization')).toBe('Bearer fixture-only');
    expect(request.headers.get('x-organization-id')).toBe(incoming.headers.get('x-organization-id'));
    expect(await request.text()).toBe('# Hello');
  });
  it('preserves binary data and rejects malformed or oversized inline files', async () => {
    const args = {
      worktree_id: uuid,
      path: 'data.bin',
      if_match: '"1"',
      idempotency_key: 'fixture-binary',
      encoding: 'base64',
      body: Buffer.from([0, 255, 123]).toString('base64'),
    };
    const request = mcpApiRequest(entry('writeFile'), args, incoming, origin);
    expect(Buffer.from(await request.arrayBuffer())).toEqual(Buffer.from([0, 255, 123]));
    expect(() =>
      mcpApiRequest(entry('writeFile'), { ...args, body: 'not base64!' }, incoming, origin),
    ).toThrow('valid base64');
    expect(() =>
      mcpApiRequest(
        entry('writeFile'),
        { ...args, encoding: 'utf8', body: 'x'.repeat(65537) },
        incoming,
        origin,
      ),
    ).toThrow('createTransfer');
  });
  it('keeps typed query values, selected organizations and JSON bodies intact', async () => {
    const request = mcpApiRequest(
      entry('listWorkspaces'),
      { limit: 10, organization_id: uuid },
      incoming,
      origin,
    );
    expect(request.headers.get('x-organization-id')).toBe(uuid);
    expect(new URL(request.url).searchParams.get('limit')).toBe('10');
    expect(entry('listWorkspaces').validate({ limit: '10' })).toBe(false);
    const create = mcpApiRequest(
      entry('createWorkspace'),
      { idempotency_key: 'fixture-create', body: { name: 'Team research' } },
      incoming,
      origin,
    );
    expect(await create.json()).toEqual({ name: 'Team research' });
  });
});
