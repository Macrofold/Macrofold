import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startPermissionFileServer } from '../../packages/runtime/src/permission-server';

it('enforces the same policy over authenticated MCP and closes its listener', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'permission-mcp-'));
  await mkdir(path.join(dir, 'docs'));
  await writeFile(path.join(dir, 'private.env'), 'private');
  await writeFile(path.join(dir, 'docs/readme.md'), 'old');
  await symlink(os.tmpdir(), path.join(dir, 'escape'));
  const server = await startPermissionFileServer(dir, [
    { version: 1, files: { read: { exclude: ['**/*.env'] }, write: { include: ['docs/**'] } } },
    { version: 1, files: { write: { exclude: ['docs/private/**'] } } },
  ]);
  const client = new Client({ name: 'fixture', version: '1' });
  try {
    expect((await fetch(server.url)).status).toBe(403);
    expect((await fetch(server.url, { headers: { Authorization: 'Bearer incorrect' } })).status).toBe(403);
    expect(
      (await fetch(server.url + '/other', { headers: { Authorization: `Bearer ${server.token}` } })).status,
    ).toBe(403);
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${server.token}` } },
      }),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(['worktree_files']);
    const call = (args: Record<string, unknown>) =>
      client.callTool({ name: 'worktree_files', arguments: args });
    expect(await call({ action: 'list', path: '' })).toMatchObject({
      content: [{ text: '{"files":["docs/readme.md"],"truncated":false}' }],
    });
    for (const args of [
      { action: 'read', path: 'private.env' },
      { action: 'read', path: '../escape' },
      { action: 'read', path: 'escape/outside' },
      { action: 'write', path: 'docs/private/blocked.md', content: 'no' },
      { action: 'delete', path: 'private.env' },
      { action: 'execute', path: 'docs/readme.md' },
    ])
      expect(await call(args)).toMatchObject({ isError: true });
    expect(await client.callTool({ name: 'shell', arguments: {} })).toMatchObject({ isError: true });
    expect(await call({ action: 'write', path: 'docs/readme.md', content: 'new' })).not.toHaveProperty(
      'isError',
      true,
    );
    expect(await call({ action: 'read', path: 'docs/readme.md' })).toMatchObject({
      content: [{ text: 'new' }],
    });
    expect(await readFile(path.join(dir, 'private.env'), 'utf8')).toBe('private');
  } finally {
    await client.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
  await expect(fetch(server.url)).rejects.toThrow();
});

it('isolates concurrent workers and never accepts another worker’s file capability', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'permission-workers-'));
  const roots = [path.join(dir, 'a'), path.join(dir, 'b')];
  await Promise.all(roots.map((root) => mkdir(root)));
  const servers = await Promise.all(roots.map((root) => startPermissionFileServer(root, [])));
  const clients = servers.map(() => new Client({ name: 'fixture', version: '1' }));
  try {
    expect(servers[0].token).not.toBe(servers[1].token);
    expect(
      (
        await fetch(servers[1].url, {
          headers: { Authorization: `Bearer ${servers[0].token}` },
        })
      ).status,
    ).toBe(403);
    await Promise.all(
      clients.map(async (client, index) => {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(servers[index].url), {
            requestInit: { headers: { Authorization: `Bearer ${servers[index].token}` } },
          }),
        );
        const result = await client.callTool({
          name: 'worktree_files',
          arguments: {
            action: 'write',
            path: 'note.txt',
            content: String(index),
          },
        });
        expect(result.isError).not.toBe(true);
      }),
    );
    expect(await Promise.all(roots.map((root) => readFile(path.join(root, 'note.txt'), 'utf8')))).toEqual([
      '0',
      '1',
    ]);
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await Promise.all(servers.map((server) => server.close()));
    await rm(dir, { recursive: true, force: true });
  }
});
