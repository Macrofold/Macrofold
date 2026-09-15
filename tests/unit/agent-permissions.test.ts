import { it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, symlink, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  agentPermissionsSchema,
  fileAllowed,
  permissionLayers,
  shellAllowed,
  toolAllowed,
} from '../../packages/contracts/permissions';
import { permissionAdapters } from '../../packages/contracts/permission-adapters';
import { permissionFileTools } from '../../packages/runtime/src/permission-files';
import { harnessNames } from '../../packages/contracts/harnesses';

it('intersects inherited include lists; child allows never override exclusions, including dotfiles', () => {
  const layers = permissionLayers(
    { version: 1, files: { write: { include: ['src/**'], exclude: ['**/*.env', 'src/private/**'] } } },
    { version: 1, files: { write: { include: ['**/*.ts', '**/*.env'] } } },
    { version: 1, files: { write: { include: ['**'], exclude: ['**/generated.ts'] } } },
  );
  expect(fileAllowed(layers, 'write', 'src/index.ts')).toBe(true);
  for (const name of [
    'outside.ts',
    'src/readme.md',
    'src/.private.env',
    'src/private/key.ts',
    'src/generated.ts',
    '../src/index.ts',
    '.git/config',
  ])
    expect(fileAllowed(layers, 'write', name), name).toBe(false);
  expect(shellAllowed(layers)).toBe(false);
  expect(fileAllowed(permissionLayers({ version: 1, files: { read: { include: [] } } }), 'read', 'a')).toBe(
    false,
  );
  expect(
    fileAllowed(permissionLayers({ version: 1, files: { read: { include: ['dot.env'] } } }), 'read', '.env'),
  ).toBe(false);
  expect(
    fileAllowed(permissionLayers({ version: 1, files: { read: { exclude: ['.env'] } } }), 'read', '.env'),
  ).toBe(false);
  expect(
    toolAllowed(permissionLayers({ version: 1, tools: { exclude: ['**/SEND*'] } }), 'connection/SEND_EMAIL'),
  ).toBe(false);
});
it.each(['../private', '/private', 'a//b', 'a\\b', '!private', '{a,b}', 'a/[xy]'])(
  'rejects nonportable policy %s',
  (pattern) => {
    expect(
      agentPermissionsSchema.safeParse({ version: 1, files: { read: { exclude: [pattern] } } }).success,
    ).toBe(false);
  },
);
it.each(harnessNames)('maps %s to checked file access without weakening inherited policy', (harness) => {
  const layers = permissionLayers({ version: 1, files: { write: { include: ['docs/**'] } } });
  expect(permissionAdapters[harness].translate(layers)).toEqual({ mode: 'guarded', shell: 'deny' });
  expect(permissionAdapters[harness].translate([{ version: 1, shell: 'deny' }])).toEqual({
    mode: 'guarded',
    shell: 'deny',
  });
  expect(permissionAdapters[harness].translate([{ version: 1, tools: { exclude: ['**/delete'] } }])).toEqual({
    mode: 'native',
    shell: 'allow',
  });
  expect(permissionAdapters[harness].translate([])).toEqual({ mode: 'native', shell: 'allow' });
  expect(() =>
    permissionAdapters[harness].translate([{ version: 1, files: { read: { include: ['../escape'] } } }]),
  ).toThrow();
});
it('guards real file IO, filters listings and refuses symlink and parent traversal', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'permission-files-'));
  try {
    const root = path.join(directory, 'worktree');
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'secret.env'), 'private');
    await writeFile(path.join(root, 'docs/guide.md'), 'old');
    await writeFile(path.join(directory, 'outside'), 'outside');
    await symlink(directory, path.join(root, 'escape'));
    const call = permissionFileTools(root, [
      { version: 1, files: { read: { exclude: ['**/*.env'] }, write: { include: ['docs/**'] } } },
    ]);
    expect(JSON.parse(await call({ action: 'list', path: '' })).files).toEqual(['docs/guide.md']);
    await expect(call({ action: 'read', path: 'secret.env' })).rejects.toThrow('denied');
    await expect(call({ action: 'write', path: 'main.ts', content: 'no' })).rejects.toThrow('denied');
    await expect(call({ action: 'read', path: 'escape/outside' })).rejects.toThrow('Symlinks');
    await expect(call({ action: 'read', path: '../outside' })).rejects.toThrow('denied');
    await call({ action: 'write', path: 'docs/guide.md', content: 'new' });
    expect(await call({ action: 'read', path: 'docs/guide.md' })).toBe('new');
    await call({ action: 'delete', path: 'docs/guide.md' });
    expect(await readFile(path.join(directory, 'outside'), 'utf8')).toBe('outside');
    expect(await readFile(path.join(root, 'secret.env'), 'utf8')).toBe('private');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
