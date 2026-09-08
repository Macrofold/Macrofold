import assert from 'node:assert/strict';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { createKey } from '../../packages/core/src/keys';
import { serveObject } from '../../packages/core/src/transfers';
import { executeRun } from '../../packages/core/src/engine';
import * as resources from '../../packages/core/src/resources';
import { saveContent } from '../../packages/providers/src/storage';
import { Client } from '../../sdk/typescript/src/client';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let foreign: Awaited<ReturnType<typeof fixtureAccount>>;
let client: Client, workspaceId: string, projectId: string;
const filePath = 'notes/日本語 + #?.json';
const content = Buffer.from('{"message":"Hello 🌍"}\n');
const apiClient = (key: string) =>
  new Client({
    baseURL: config.origin,
    apiKey: key,
    retries: 0,
    fetch: (url, init) => handleApi(new Request(url, init)),
  });
const read = (path: string, key = account.key) =>
  handleApi(
    new Request(`${config.origin}/v1/workspaces/${workspaceId}/file?${new URLSearchParams({ path })}`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    }),
  );

beforeAll(async () => {
  account = await fixtureAccount('File reader');
  foreign = await fixtureAccount('Foreign file reader');
  client = apiClient(account.key);
  const project = await client.projects.create({ name: 'Persisted file reads' });
  projectId = project.id;
  assert(project.default_workspace_id);
  workspaceId = project.default_workspace_id;
  const workspace = await client.workspaces.get(workspaceId);
  await client.workspaces.writeFile(workspaceId, { path: filePath, content, ifMatch: workspace.revision });
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

it('returns complete persisted bytes, safe headers and the current revision for an encoded path', async () => {
  const response = await read(filePath);
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
  expect(response.headers.get('content-type')).toBe('application/octet-stream');
  expect(response.headers.get('content-disposition')).toBe(
    `attachment; filename*=UTF-8''${encodeURIComponent(filePath)}`,
  );
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('etag')).toBe(`"${(await client.workspaces.get(workspaceId)).revision}"`);
});

it.each([
  '',
  '../private',
  '/etc/passwd',
  'notes/../secret',
  '.git/config',
  'notes\\secret',
  'notes//secret',
])('rejects unsafe or empty path %j', async (path) => {
  expect((await read(path)).status).toBe(400);
});

it('distinguishes missing files and unsupported symlinks from empty files', async () => {
  expect((await read('missing.txt')).status).toBe(404);
  const project = await client.projects.create({ name: 'Empty and linked files' });
  const id = project.default_workspace_id;
  assert(id);
  await transaction(account.p.organizationId, async (tx) => {
    const file = await saveContent(account.p.organizationId, Buffer.alloc(0));
    const link = await saveContent(account.p.organizationId, Buffer.from('empty.txt'));
    await resources.update(tx, 'workspaces', id, {
      files: [
        { ...file, path: 'empty.txt', type: 'file' },
        { ...link, path: 'link', type: 'symlink' },
      ],
    });
  });
  expect(await client.workspaces.readFile(id, { path: 'empty.txt' })).toEqual(new Uint8Array());
  await expect(client.workspaces.readFile(id, { path: 'link' })).rejects.toMatchObject({
    status: 409,
    code: 'unsupported_file',
  });
});

it('enforces tenant, project, scope and revocation checks before disclosing content', async () => {
  expect((await read(filePath, '')).status).toBe(401);
  expect((await read(filePath, foreign.key)).status).toBe(404);
  const keys = await transaction(account.p.organizationId, async (tx) => ({
    allowed: await createKey(tx, account.p, {
      name: 'Allowed',
      scopes: ['files:read'],
      project_id: projectId,
    }),
    noScope: await createKey(tx, account.p, { name: 'Metadata only', scopes: ['projects:read'] }),
    wrongProject: await createKey(tx, account.p, {
      name: 'Other project',
      scopes: ['files:read'],
      project_id: (await resources.create(tx, 'projects', account.p.organizationId, { name: 'Other' })).id,
    }),
  }));
  expect(Buffer.from(await (await read(filePath, keys.allowed.secret)).arrayBuffer())).toEqual(content);
  expect((await read(filePath, keys.noScope.secret)).status).toBe(403);
  expect((await read(filePath, keys.wrongProject.secret)).status).toBe(404);
  await client.apiKeys.revoke(String(keys.allowed.id));
  expect((await read(filePath, keys.allowed.secret)).status).toBe(401);
});

it('returns the full 4 MiB boundary and rejects larger metadata before loading objects', async () => {
  const project = await client.projects.create({ name: 'Bounded reads' });
  const id = project.default_workspace_id;
  assert(id);
  const bytes = Buffer.alloc(4 * 1024 * 1024, 255);
  await transaction(account.p.organizationId, async (tx) => {
    const file = await saveContent(account.p.organizationId, bytes);
    await resources.update(tx, 'workspaces', id, {
      files: [
        { ...file, path: 'boundary.bin', type: 'file' },
        // No object exists: a storage lookup would fail instead of the required size rejection.
        {
          ...file,
          key: 'must-not-be-loaded',
          size_bytes: String(bytes.length + 1),
          path: 'large.bin',
          type: 'file',
        },
      ],
    });
  });
  expect(Buffer.from(await client.workspaces.readFile(id, { path: 'boundary.bin' })).equals(bytes)).toBe(
    true,
  );
  await expect(client.workspaces.readFile(id, { path: 'large.bin' })).rejects.toMatchObject({
    status: 413,
    code: 'file_too_large',
  });
});

it('downloads complete larger files through a separately authenticated capability', async () => {
  const project = await client.projects.create({ name: 'Large download' });
  const workspace = project.default_workspace_id;
  assert(workspace);
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 1, 128);
  await transaction(account.p.organizationId, async (tx) => {
    const stored = await saveContent(account.p.organizationId, bytes);
    await resources.update(tx, 'workspaces', workspace, {
      files: [{ ...stored, path: 'large.bin', type: 'file' }],
    });
  });
  const response = await handleApi(
    new Request(`${config.origin}/v1/workspaces/${workspace}/file?path=large.bin&download=true`, {
      headers: { Authorization: `Bearer ${account.key}` },
    }),
  );
  expect(response.status).toBe(302);
  const location = response.headers.get('location');
  assert(location);
  const url = new URL(location);
  expect(url.pathname).toMatch(/^\/objects\//);
  expect(url.href).not.toContain(account.key);
  const request = new Request(url);
  expect(request.headers.has('authorization')).toBe(false);
  const download = await serveObject(request, decodeURIComponent(url.pathname.slice('/objects/'.length)));
  expect(download.status).toBe(200);
  expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true);
});

it('keeps reads on the published revision during execution, then exposes the checkpointed edits', async () => {
  const project = await client.projects.create({ name: 'Read while running' });
  const id = project.default_workspace_id;
  assert(id);
  let workspace = await client.workspaces.get(id);
  await client.workspaces.writeFile(id, { path: filePath, content, ifMatch: workspace.revision });
  workspace = await client.workspaces.get(id);
  const run = await client.runs.create({
    workspace_id: id,
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
    prompt: 'Replace the file with the fixture bytes.',
  });
  const updated = Buffer.from([0, 255, 10]);
  let executions = 0;
  await executeRun(account.p.organizationId, run.run_id, {
    async execute(request) {
      executions++;
      expect((await client.runs.get(run.run_id)).status).toBe('running');
      expect(request.files.find((file) => file.path === filePath)?.bytes).toEqual(content);
      expect(Buffer.from(await client.workspaces.readFile(id, { path: filePath }))).toEqual(content);
      await expect(
        client.workspaces.writeFile(id, { path: filePath, content: updated, ifMatch: workspace.revision }),
      ).rejects.toMatchObject({ status: 409, code: 'workspace_busy' });
      return {
        output: 'File updated.',
        files: [{ path: filePath, bytes: updated }],
        inputTokens: 0,
        outputTokens: 0,
        usageComplete: true,
      };
    },
  });
  expect(executions).toBe(1);
  const result = await client.runs.wait(run.run_id);
  expect(result.persistence_status).toBe('verified');
  expect(Buffer.from(await client.workspaces.readFile(id, { path: filePath }))).toEqual(updated);
  const published = await client.workspaces.get(id);
  expect(published.revision).not.toBe(workspace.revision);
  await client.workspaces.deleteFile(id, { path: filePath, ifMatch: published.revision });
  await expect(client.workspaces.readFile(id, { path: filePath })).rejects.toMatchObject({
    status: 404,
    code: 'not_found',
  });
});

it.each(['missing', 'corrupt'])(
  'rejects %s stored content without disclosing bytes or object keys',
  async (fault) => {
    const project = await client.projects.create({ name: 'Unreadable content' });
    const id = project.default_workspace_id;
    assert(id);
    const stored = await saveContent(account.p.organizationId, content);
    const file = {
      ...stored,
      path: filePath,
      type: 'file',
      ...(fault === 'missing'
        ? { key: `${account.p.organizationId}/content/missing` }
        : { sha256: '0'.repeat(64) }),
    };
    await transaction(account.p.organizationId, (tx) =>
      resources.update(tx, 'workspaces', id, { files: [file] }),
    );
    const response = await handleApi(
      new Request(`${config.origin}/v1/workspaces/${id}/file?${new URLSearchParams({ path: filePath })}`, {
        headers: { Authorization: `Bearer ${account.key}` },
      }),
    );
    expect(response.status).toBe(500);
    const payload = await response.text();
    expect(JSON.parse(payload).error.code).toBe('internal_error');
    expect(payload).not.toContain(content.toString());
    expect(payload).not.toContain(file.key);
    expect(payload).not.toContain(file.sha256);
  },
);
