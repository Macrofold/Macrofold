import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { FileRecord } from '../packages/core/src/files';
import {
  branchName,
  gitMetadataPath,
  gitRevision,
  withRepository,
} from '../packages/providers/src/git-repository';
import { saveContent } from '../packages/providers/src/storage';
const exec = promisify(execFile),
  org = crypto.randomUUID();
async function file(name: string, text: string, options: Partial<FileRecord> = {}): Promise<FileRecord> {
  return {
    ...(await saveContent(org, Buffer.from(text))),
    path: name,
    type: 'file',
    modified_at: new Date().toISOString(),
    git_ignored: false,
    ...options,
  };
}
describe('Portable Git checkpoints', () => {
  it('keeps full commit ancestry, modes, ignored data classification and a native-verifiable bundle', async () => {
    const initial = await gitRevision(
      org,
      'main',
      [
        await file('README.md', 'one\n'),
        await file('.gitignore', 'cache/\n'),
        await file('cache/result.bin', 'preserve me'),
        await file('script.sh', '#!/bin/sh\nexit 0\n', { mode: 0o755 }),
        await file('readme-link', 'README.md', { type: 'symlink' }),
      ],
      [],
      'Initial',
    );
    expect(initial.files.find((f) => f.path === 'cache/result.bin')?.git_ignored).toBe(true);
    expect(initial.files.find((f) => f.path === '.gitignore')?.git_ignored).toBe(false);
    const second = await gitRevision(
      org,
      'main',
      [...initial.files.filter((f) => f.path !== 'README.md'), await file('README.md', 'two\n')],
      initial.git_files,
      'Second',
    );
    const bundle = await withRepository(second.git_files, (repo) => repo.bundle());
    const dir = await mkdtemp(path.join(tmpdir(), 'native-git-test-'));
    try {
      await exec('git', ['init', dir]);
      await writeFile(path.join(dir, 'test.bundle'), bundle.bytes);
      await exec('git', ['bundle', 'verify', 'test.bundle'], { cwd: dir });
      await exec('git', ['fetch', 'test.bundle', 'refs/heads/export:refs/heads/review'], { cwd: dir });
      const history = await exec('git', ['rev-list', 'review'], { cwd: dir });
      expect(history.stdout.trim().split('\n')).toEqual([second.git_commit, initial.git_commit]);
      const tree = (await exec('git', ['ls-tree', 'review'], { cwd: dir })).stdout;
      expect(tree).toContain('100755 blob');
      expect(tree).toContain('120000 blob');
      expect(tree).not.toContain('cache');
      expect((await exec('git', ['show', 'review:README.md'], { cwd: dir })).stdout).toBe('two\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('branches preserve source history and can select historical refs', async () => {
    const base = await gitRevision(org, 'main', [await file('note.txt', 'base')], [], 'Base');
    const changed = await gitRevision(
      org,
      'feature',
      [await file('note.txt', 'feature')],
      base.git_files,
      'Feature',
    );
    await withRepository(changed.git_files, async (repo) => {
      expect(await repo.head('main')).toBe(base.git_commit);
      expect(await repo.head('feature')).toBe(changed.git_commit);
      await repo.select('review', 'main');
      expect(await repo.head()).toBe(base.git_commit);
      expect((await repo.files(org)).map((f) => f.path)).toEqual(['note.txt']);
    });
  });
  it('refuses unsafe refs, executable metadata and symlinked Git files', async () => {
    expect(() => branchName('a/../b')).toThrow();
    expect(() => branchName('a.lock')).toThrow();
    expect(gitMetadataPath('.git/hooks/post-checkout')).toBe(false);
    expect(gitMetadataPath('.git/objects/info/alternates')).toBe(false);
    const bad = await file('.git/HEAD', '/etc/passwd', { type: 'symlink' });
    await expect(withRepository([bad], async () => null)).rejects.toThrow('ordinary files');
  });
});
