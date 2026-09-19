import assert from 'node:assert/strict';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { fixtureAccount } from '../fixtures/account';
import { pool, authPool, transaction } from '../../packages/db';
import { handleApi } from '../../packages/core/src/http';
import { config } from '../../packages/core/src/config';
import { createKey } from '../../packages/core/src/keys';
import { executeRun } from '../../packages/core/src/engine';
import * as resources from '../../packages/core/src/resources';
import { type FileRecord } from '../../packages/core/src/files';
import { saveContent, storage } from '../../packages/providers/src/storage';
import { withRepository } from '../../packages/providers/src/git-repository';
import { Client } from '../../sdk/typescript/src/client';

let account: Awaited<ReturnType<typeof fixtureAccount>>;
let foreign: Awaited<ReturnType<typeof fixtureAccount>>;
let client: Client;
const apiClient = (key: string) =>
  new Client({
    baseURL: config.origin,
    apiKey: key,
    retries: 0,
    fetch: (url, init) => handleApi(new Request(url, init)),
  });
async function fixture() {
  const workspace = await client.workspaces.create({ name: 'File mutation fixture' });
  assert(workspace.default_worktree_id);
  const worktreeId = workspace.default_worktree_id;
  const revision = async () => (await client.worktrees.get(worktreeId)).revision;
  const write = async (path: string, text = 'durable bytes') =>
    client.worktrees.writeFile(worktreeId, {
      path,
      content: Buffer.from(text),
      ifMatch: await revision(),
      create_only: true,
    });
  return { workspaceId: workspace.id, worktreeId, revision, write };
}
beforeAll(async () => {
  account = await fixtureAccount('File mutations');
  foreign = await fixtureAccount('Foreign file mutations');
  client = apiClient(account.key);
});
afterAll(async () => {
  await pool.end();
  await authPool.end();
});

it('persists folders through Git and restore, with lazy children, stable pagination and flat search', async () => {
  const { worktreeId, revision, write } = await fixture();
  const folder = await client.worktrees.createFolder(worktreeId, {
    path: 'research',
    ifMatch: await revision(),
  });
  expect(folder).toMatchObject({
    status: 'succeeded',
    kind: 'folder_create',
    result: {
      path: 'research',
      entry: { path: 'research', type: 'directory', revision: folder.result?.revision },
    },
  });
  expect(folder.result?.entry).not.toHaveProperty('size_bytes');
  expect(folder.result?.entry).not.toHaveProperty('sha256');
  assert(folder.result?.checkpoint_id);
  await client.worktrees.createFolder(worktreeId, { path: 'research/assets', ifMatch: await revision() });
  await write('research/brief.md');
  await write('top.txt');
  const root = await client.worktrees.listFiles(worktreeId, { recursive: false, limit: 1 });
  expect(root.entries.map((entry) => [entry.path, entry.type])).toEqual([['research', 'directory']]);
  expect(root.next_cursor).toBe('research');
  const next = await client.worktrees.listFiles(worktreeId, {
    recursive: false,
    limit: 1,
    cursor: root.next_cursor!,
  });
  expect(next.entries.map((entry) => entry.path)).toEqual(['top.txt']);
  expect(next.next_cursor).toBeNull();
  const children = await client.worktrees.listFiles(worktreeId, { path: 'research', recursive: false });
  expect(children.entries.map((entry) => [entry.path, entry.type])).toEqual([
    ['research/.gitkeep', 'file'],
    ['research/assets', 'directory'],
    ['research/brief.md', 'file'],
  ]);
  expect(
    (await client.worktrees.listFiles(worktreeId, { query: 'assets' })).entries.map((entry) => [
      entry.path,
      entry.type,
    ]),
  ).toEqual([['research/assets/.gitkeep', 'file']]);
  const checkpoint = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'checkpoints', folder.result!.checkpoint_id!, account.p),
  );
  await withRepository(checkpoint.git_files as FileRecord[], async (repo) => {
    expect([...(await repo.tree())].map(([path]) => path)).toEqual(['research/.gitkeep']);
  });
  await client.worktrees.restore(worktreeId, { checkpoint_id: folder.result.checkpoint_id });
  expect(
    (await client.worktrees.listFiles(worktreeId, { recursive: false })).entries.map((entry) => [
      entry.path,
      entry.type,
    ]),
  ).toEqual([['research', 'directory']]);
  expect(await client.worktrees.readFile(worktreeId, { path: 'research/.gitkeep' })).toEqual(
    new Uint8Array(),
  );
});

it('renames bytes and executable or symlink metadata atomically, with idempotent authoritative results', async () => {
  const { worktreeId, revision } = await fixture();
  const path = 'scripts/日本語 + #?.sh';
  const bytes = Buffer.from('#!/bin/sh\necho preserved\n');
  await transaction(account.p.organizationId, async (tx) => {
    const base = { modified_at: new Date().toISOString(), git_ignored: false };
    await resources.update(tx, 'worktrees', worktreeId, {
      files: [
        { ...base, ...(await saveContent(account.p.organizationId, bytes)), path, type: 'file', mode: 0o755 },
        {
          ...base,
          ...(await saveContent(account.p.organizationId, Buffer.from(path))),
          path: 'script-link',
          type: 'symlink',
        },
      ],
    });
  });
  const options = { path, new_path: 'bin/renamed.sh', ifMatch: await revision() };
  const requestOptions = { idempotencyKey: crypto.randomUUID() };
  const renamed = await client.worktrees.renameFile(worktreeId, options, requestOptions);
  expect(renamed.result).toMatchObject({
    path: 'bin/renamed.sh',
    previous_path: path,
    entry: {
      path: 'bin/renamed.sh',
      type: 'file',
      size_bytes: String(bytes.length),
      revision: renamed.result?.revision,
    },
  });
  expect(renamed.result?.entry).not.toHaveProperty('key');
  expect(renamed.result?.entry).not.toHaveProperty('mode');
  expect(await client.worktrees.renameFile(worktreeId, options, requestOptions)).toEqual(renamed);
  await expect(client.worktrees.readFile(worktreeId, { path })).rejects.toMatchObject({ status: 404 });
  expect(Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'bin/renamed.sh' }))).toEqual(
    bytes,
  );
  const worktree = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'worktrees', worktreeId, account.p),
  );
  expect((worktree.files as FileRecord[]).find((file) => file.path === 'bin/renamed.sh')?.mode).toBe(0o755);
  await withRepository(worktree.git_files as FileRecord[], async (repo) => {
    expect((await repo.tree()).get('bin/renamed.sh')?.mode).toBe('100755');
  });
  const link = await client.worktrees.renameFile(worktreeId, {
    path: 'script-link',
    new_path: 'renamed-link',
    ifMatch: await revision(),
  });
  expect(link.result?.entry?.type).toBe('symlink');
  await expect(client.worktrees.readFile(worktreeId, { path: 'renamed-link' })).rejects.toMatchObject({
    status: 409,
    code: 'unsupported_file',
  });
  const deleted = await client.worktrees.deleteFile(worktreeId, {
    path: 'bin/renamed.sh',
    ifMatch: await revision(),
  });
  expect(deleted.result).toMatchObject({ path: 'bin/renamed.sh', revision: await revision() });
  expect(deleted.result?.entry).toBeUndefined();
});

it('keeps the old name visible until rename verification commits, and rolls back a failed verification', async () => {
  const { worktreeId, revision, write } = await fixture();
  const written = await write('source.txt', 'preserved');
  const originalRevision = await revision();
  const worktree = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'worktrees', worktreeId, account.p),
  );
  const original = (worktree.files as FileRecord[]).find((file) => file.path === 'source.txt')!;
  const get = storage.get.bind(storage);
  let entered!: () => void, release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercept = true;
  const read = vi.spyOn(storage, 'get').mockImplementation(async (key) => {
    if (key === original.key && intercept) {
      intercept = false;
      entered();
      await wait;
      throw new Error('Fixture verification failure');
    }
    return get(key);
  });
  const rename = client.worktrees.renameFile(worktreeId, {
    path: 'source.txt',
    new_path: 'renamed.txt',
    ifMatch: originalRevision,
  });
  const failure = expect(rename).rejects.toMatchObject({ status: 500 });
  try {
    await blocked;
    expect((await client.worktrees.listFiles(worktreeId)).entries.map((entry) => entry.path)).toEqual([
      'source.txt',
    ]);
    expect(
      Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'source.txt' })).toString(),
    ).toBe('preserved');
  } finally {
    release();
    await failure;
    read.mockRestore();
  }
  expect(await client.worktrees.get(worktreeId)).toMatchObject({
    revision: originalRevision,
    latest_checkpoint_id: written.result?.checkpoint_id,
  });
  expect((await client.worktrees.listFiles(worktreeId)).entries.map((entry) => entry.path)).toEqual([
    'source.txt',
  ]);
});

it('rejects collisions before replacing content, including files used as parent directories', async () => {
  const { worktreeId, revision, write } = await fixture();
  await write('source.txt', 'original');
  await write('folder/child.txt');
  const original = await client.worktrees.get(worktreeId);
  const ifMatch = await revision();
  const conflict = { status: 409, code: 'file_path_conflict' };
  for (const path of ['source.txt', 'folder', 'source.txt/child']) {
    await expect(client.worktrees.createFolder(worktreeId, { path, ifMatch })).rejects.toMatchObject(
      conflict,
    );
    await expect(
      client.worktrees.writeFile(worktreeId, {
        path,
        content: Buffer.from('replacement'),
        create_only: true,
        ifMatch,
      }),
    ).rejects.toMatchObject(conflict);
  }
  for (const new_path of ['source.txt', 'source.txt/child', 'folder', 'folder/child.txt'])
    await expect(
      client.worktrees.renameFile(worktreeId, { path: 'source.txt', new_path, ifMatch }),
    ).rejects.toMatchObject(conflict);
  await expect(
    client.worktrees.renameFile(worktreeId, { path: 'missing.txt', new_path: 'new.txt', ifMatch }),
  ).rejects.toMatchObject({ status: 404 });
  expect(await client.worktrees.get(worktreeId)).toMatchObject({
    revision: original.revision,
    latest_checkpoint_id: original.latest_checkpoint_id,
  });
  expect(Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'source.txt' })).toString()).toBe(
    'original',
  );
});

it.each(['../outside', '/etc/passwd', '.git/config', '.agent/state', 'a//b', 'a\\b', 'a/./b'])(
  'rejects unsafe folder and rename paths %j',
  async (path) => {
    const { worktreeId, revision, write } = await fixture();
    await write('source.txt');
    const ifMatch = await revision();
    await expect(client.worktrees.createFolder(worktreeId, { path, ifMatch })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_path',
    });
    await expect(
      client.worktrees.renameFile(worktreeId, { path: 'source.txt', new_path: path, ifMatch }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_path' });
    expect(await revision()).toBe(ifMatch);
  },
);

it('serializes competing creates and rejects stale folder or rename requests', async () => {
  const { worktreeId, revision } = await fixture();
  const ifMatch = await revision();
  const outcomes = await Promise.allSettled(
    ['one', 'two'].map((text) =>
      client.worktrees.writeFile(worktreeId, {
        path: 'race.txt',
        content: Buffer.from(text),
        create_only: true,
        ifMatch,
      }),
    ),
  );
  expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { status: 412, code: 'stale_revision' },
  });
  await expect(client.worktrees.createFolder(worktreeId, { path: 'stale', ifMatch })).rejects.toMatchObject(
    { status: 412 },
  );
  await expect(
    client.worktrees.renameFile(worktreeId, { path: 'race.txt', new_path: 'stale.txt', ifMatch }),
  ).rejects.toMatchObject({ status: 412 });
  expect((await client.worktrees.listFiles(worktreeId)).entries.map((entry) => entry.path)).toEqual([
    'race.txt',
  ]);
});

it('honors tenant, workspace and scope authorization for both new mutations and operation lookup', async () => {
  const { worktreeId, workspaceId, revision, write } = await fixture();
  await write('source.txt');
  const otherWorkspace = await client.workspaces.create({ name: 'Other workspace' });
  const keys = await transaction(account.p.organizationId, async (tx) => ({
    readOnly: await createKey(tx, account.p, {
      name: 'Read only',
      scopes: ['files:read'],
      workspace_id: workspaceId,
    }),
    wrongWorkspace: await createKey(tx, account.p, {
      name: 'Other workspace',
      scopes: ['files:read', 'files:write'],
      workspace_id: otherWorkspace.id,
    }),
  }));
  const ifMatch = await revision();
  for (const [key, status] of [
    [foreign.key, 404],
    [keys.readOnly.secret, 403],
    [keys.wrongWorkspace.secret, 404],
  ] as const) {
    const denied = apiClient(key);
    await expect(
      denied.worktrees.createFolder(worktreeId, { path: 'private', ifMatch }),
    ).rejects.toMatchObject({ status });
    await expect(
      denied.worktrees.renameFile(worktreeId, { path: 'source.txt', new_path: 'private.txt', ifMatch }),
    ).rejects.toMatchObject({ status });
  }
  const allowed = await client.worktrees.createFolder(worktreeId, { path: 'private', ifMatch });
  await expect(apiClient(foreign.key).operations.get(allowed.id)).rejects.toMatchObject({ status: 404 });
  await expect(apiClient(keys.wrongWorkspace.secret).operations.get(allowed.id)).rejects.toMatchObject({
    status: 404,
  });
  expect((await apiClient(keys.readOnly.secret).operations.get(allowed.id)).id).toBe(allowed.id);
});

it('refuses folder creation and renaming while the worktree writer is active', async () => {
  const { worktreeId, revision, write } = await fixture();
  await write('source.txt');
  await client.worktrees.createFolder(worktreeId, { path: 'retained-folder', ifMatch: await revision() });
  const ifMatch = await revision();
  const run = await client.runs.create({
    worktree_id: worktreeId,
    harness: 'codex',
    model: 'fixture-model',
    billing_mode: 'managed',
    prompt: 'Preserve the fixture files.',
  });
  await executeRun(account.p.organizationId, run.run_id, {
    async execute(request) {
      expect(request.files.map((file) => file.path)).toContain('retained-folder/.gitkeep');
      await expect(
        client.worktrees.createFolder(worktreeId, { path: 'busy', ifMatch }),
      ).rejects.toMatchObject({ status: 409, code: 'worktree_busy' });
      await expect(
        client.worktrees.renameFile(worktreeId, { path: 'source.txt', new_path: 'busy.txt', ifMatch }),
      ).rejects.toMatchObject({ status: 409, code: 'worktree_busy' });
      return {
        output: 'Preserved.',
        files: request.files,
        inputTokens: 0,
        outputTokens: 0,
        usageComplete: true,
      };
    },
  });
  expect((await client.worktrees.listFiles(worktreeId)).entries.map((entry) => entry.path)).toEqual([
    'retained-folder/.gitkeep',
    'source.txt',
  ]);
});

it('duplicates without downloading or changing the source, with CAS, authorization and restore protection', async () => {
  const { worktreeId, revision, write } = await fixture();
  await write('report.md', '# Original');
  const before = await revision();
  const duplicated = await client.worktrees.duplicateFile(worktreeId, {
    path: 'report.md',
    new_path: 'notes/report copy.md',
    ifMatch: before,
  });
  expect(duplicated).toMatchObject({
    kind: 'file_duplicate',
    status: 'succeeded',
    result: { path: 'notes/report copy.md' },
  });
  expect(duplicated.result).not.toHaveProperty('previous_path');
  expect(Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'report.md' })).toString()).toBe(
    '# Original',
  );
  expect(
    Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'notes/report copy.md' })).toString(),
  ).toBe('# Original');
  await expect(
    client.worktrees.duplicateFile(worktreeId, {
      path: 'report.md',
      new_path: 'stale.md',
      ifMatch: before,
    }),
  ).rejects.toMatchObject({ status: 412 });
  await expect(
    client.worktrees.duplicateFile(worktreeId, {
      path: 'report.md',
      new_path: 'notes/report copy.md',
      ifMatch: await revision(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    client.worktrees.duplicateFile(worktreeId, {
      path: 'report.md',
      new_path: '../escape',
      ifMatch: await revision(),
    }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    apiClient(foreign.key).worktrees.duplicateFile(worktreeId, {
      path: 'report.md',
      new_path: 'foreign.md',
      ifMatch: await revision(),
    }),
  ).rejects.toMatchObject({ status: 404 });
  await client.worktrees.deleteFile(worktreeId, {
    path: 'notes/report copy.md',
    ifMatch: await revision(),
  });
  await client.worktrees.restore(worktreeId, { checkpoint_id: duplicated.result!.checkpoint_id! });
  expect(
    Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'notes/report copy.md' })).toString(),
  ).toBe('# Original');
});

it('reuses verified unchanged payloads and leaves the SQL pool idle during immutable preparation', async () => {
  const { worktreeId, write, revision } = await fixture();
  await write('large-kept.txt', 'unchanged '.repeat(10000));
  const ws = await transaction(account.p.organizationId, (tx) =>
    resources.get(tx, 'worktrees', worktreeId, account.p),
  );
  const kept = ws.files!.find((file) => file.path === 'large-kept.txt')!;
  const get = storage.get.bind(storage);
  let outsideSql = false;
  const read = vi.spyOn(storage, 'get').mockImplementation(async (key) => {
    expect(key).not.toBe(kept.key);
    outsideSql ||= pool.idleCount === pool.totalCount;
    return get(key);
  });
  try {
    await client.worktrees.writeFile(worktreeId, {
      path: 'small.txt',
      content: Buffer.from('small change'),
      ifMatch: await revision(),
    });
    expect(outsideSql).toBe(true);
  } finally {
    read.mockRestore();
  }
  expect(
    Buffer.from(await client.worktrees.readFile(worktreeId, { path: 'large-kept.txt' })).toString(),
  ).toBe('unchanged '.repeat(10000));
});

it('expires an abandoned preparation and reauthorizes the final publication', async () => {
  const { prepareFileMutation } = await import('../../packages/core/src/files');
  const { worktreeId, revision } = await fixture();
  const prepared = await prepareFileMutation(account.p, worktreeId, await revision(), {
    kind: 'file_write',
    path: 'pending.txt',
    bytes: Buffer.from('staged'),
    createOnly: true,
  });
  try {
    const restricted = { ...account.p, workspaceIds: [crypto.randomUUID()] };
    await expect(
      transaction(account.p.organizationId, (tx) => prepared.commit(tx, restricted)),
    ).rejects.toMatchObject({ status: 404 });
    await transaction(account.p.organizationId, (tx) =>
      tx.query("UPDATE storage_preparations SET expires_at=now()-interval '1 second'"),
    );
    await expect(
      transaction(account.p.organizationId, (tx) => prepared.commit(tx, account.p)),
    ).rejects.toMatchObject({ code: 'preparation_expired' });
    expect((await client.worktrees.listFiles(worktreeId)).entries).toEqual([]);
  } finally {
    await prepared.dispose();
  }
});
