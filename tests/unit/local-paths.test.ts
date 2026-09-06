import { it, expect } from 'vitest';
import { mkdtemp, mkdir, symlink, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { relativeFile, safeLocalPath, saveBaseline } from '../../packages/cli/src/local-project';
it('refuses metadata aliases and filesystem-specific escape paths before local writes', () => {
  for (const p of [
    '../a',
    '.GIT/config',
    '.Agent/link.json',
    'a/.agent/x',
    'C:drive',
    'a/aux.txt',
    'folder./file',
    'a\\b',
    '/root',
    'a//b',
    'a\0b',
  ])
    expect(() => relativeFile(p), p).toThrow();
  expect(relativeFile('notes/Avina-CoWork.md')).toBe('notes/Avina-CoWork.md');
});
it('does not follow a local symlink to customer files or overwrite metadata through an alias', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cli-path-fixture-'));
  try {
    const root = path.join(dir, 'work'),
      outside = path.join(dir, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, 'important'), 'original');
    await symlink(outside, path.join(root, 'link'));
    await expect(safeLocalPath(root, 'link/important')).rejects.toThrow('symlink');
    await symlink(outside, path.join(root, '.agent'));
    await expect(saveBaseline(root, crypto.randomUUID(), {})).rejects.toThrow('ordinary');
    expect(await readFile(path.join(outside, 'important'), 'utf8')).toBe('original');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
