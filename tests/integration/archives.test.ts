import { it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, readlink, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { extract as extractTar } from 'tar';
import { pool, authPool, transaction } from '../../packages/db';
import { fixtureAccount } from '../fixtures/account';
import * as resources from '../../packages/core/src/resources';
import { exportCheckpoint } from '../../packages/core/src/exports';
import { saveContent } from '../../packages/providers/src/storage';
import { serveObject } from '../../packages/core/src/transfers';
import type { FileRecord } from '../../packages/core/src/files';
afterAll(async () => {
  await pool.end();
  await authPool.end();
});
it('exports actual tar content with user manifest-name collisions, executable mode, ignored files and safe symlinks', async () => {
  const { p } = await fixtureAccount('Archive fixture');
  const make = async (name: string, text: string, extra: Partial<FileRecord> = {}): Promise<FileRecord> => ({
    ...(await saveContent(p.organizationId, Buffer.from(text))),
    path: name,
    type: 'file',
    modified_at: new Date().toISOString(),
    git_ignored: false,
    ...extra,
  });
  const files = [
    await make('manifest.json', 'user content'),
    await make('cache/private.txt', 'ignored', { git_ignored: true }),
    await make('bin/run.sh', '#!/bin/sh\nexit 0\n', { mode: 0o755 }),
    await make('shortcut', 'manifest.json', { type: 'symlink' }),
  ];
  const create = async (f: FileRecord[]) =>
    transaction(p.organizationId, async (tx) => {
      const project = await resources.create(tx, 'projects', p.organizationId, { name: 'Archive' });
      const cp = await resources.create(tx, 'checkpoints', p.organizationId, {
        project_id: project.id,
        verification: 'verified',
        files: f,
        git_files: [],
      });
      return exportCheckpoint(tx, p, cp.id, 'portable_archive');
    });
  const operation = await create(files);
  const result = operation.result as any;
  const response = await serveObject(
    new Request(result.download_url),
    decodeURIComponent(new URL(result.download_url).pathname.split('/').pop()!),
  );
  const dir = await mkdtemp(path.join(tmpdir(), 'archive-fixture-'));
  try {
    await writeFile(path.join(dir, 'export.tar.gz'), Buffer.from(await response.arrayBuffer()));
    await extractTar({ cwd: dir, file: path.join(dir, 'export.tar.gz') });
    expect(await readFile(path.join(dir, 'workspace/manifest.json'), 'utf8')).toBe('user content');
    expect(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')).files).toHaveLength(4);
    expect(await readFile(path.join(dir, 'workspace/cache/private.txt'), 'utf8')).toBe('ignored');
    expect(await readlink(path.join(dir, 'workspace/shortcut'))).toBe('manifest.json');
    expect((await lstat(path.join(dir, 'workspace/bin/run.sh'))).mode & 0o111).toBe(0o111);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  await expect(create([await make('escape', '../../outside', { type: 'symlink' })])).rejects.toMatchObject({
    code: 'unsafe_symlink',
  });
  await expect(
    create([await make('folder', '.', { type: 'symlink' }), await make('folder/child', 'bad')]),
  ).rejects.toMatchObject({ code: 'unsafe_symlink' });
});
