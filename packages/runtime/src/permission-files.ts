import path from 'node:path';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { fileAllowed, type PermissionLayers } from '../../contracts/permissions';

export const fileToolName = 'worktree_files';
export const fileToolDescription =
  'Read, list, write, delete files or create folders in the worktree. Paths are relative. File permissions are enforced. Write replaces UTF-8 text; use read first when editing. List returns up to 1,000 permitted files.';
export const fileToolShape = {
  action: z.enum(['list', 'read', 'write', 'delete', 'mkdir']),
  path: z.string().max(4096),
  content: z
    .string()
    .max(25 * 1024 * 1024)
    .optional(),
};
export const fileToolSchema = z.object(fileToolShape).strict();
const MAX_FILE = 25 * 1024 * 1024;

/** Shared implementation behind native tool adapters. Guarded runs expose no
 * shell, subagent, local connector or native file tool that bypasses this check.
 * Symlinks are omitted at hydration and rejected here, including every parent. */
export function permissionFileTools(root: string, layers: PermissionLayers) {
  let pending: Promise<unknown> = Promise.resolve();
  async function safePath(relative: string, allowMissing = false) {
    if (
      !relative ||
      relative.startsWith('/') ||
      /[\\\0]/.test(relative) ||
      relative.split('/').some((s) => !s || s === '.' || s === '..')
    )
      throw new Error('Use a relative worktree path.');
    let current = root;
    if (!(await lstat(current)).isDirectory()) throw new Error('Invalid worktree root.');
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      try {
        if ((await lstat(current)).isSymbolicLink())
          throw new Error('Symlinks are not allowed by guarded file access.');
      } catch (error) {
        if (!(allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
      }
    }
    return current;
  }
  function requireFile(action: 'read' | 'write', relative: string) {
    if (!fileAllowed(layers, action, relative)) throw new Error('File permission denied.');
  }
  async function execute(input: unknown) {
    const args = fileToolSchema.parse(input);
    if (args.action === 'list') {
      const start = args.path ? await safePath(args.path) : root;
      const files: string[] = [];
      let visited = 0;
      async function walk(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (++visited > 100_000) throw new Error('Narrow the listing path.');
          const absolute = path.join(directory, entry.name),
            relative = path.relative(root, absolute).split(path.sep).join('/');
          if (entry.isSymbolicLink() || ['.git', '.agent', '.platform-runtime'].includes(entry.name))
            continue;
          if (entry.isDirectory()) await walk(absolute);
          else if (entry.isFile() && fileAllowed(layers, 'read', relative)) files.push(relative);
          if (files.length >= 1000) return;
        }
      }
      await walk(start);
      return JSON.stringify({ files, truncated: files.length >= 1000 });
    }
    const action = args.action === 'read' ? 'read' : 'write';
    const target = args.action === 'mkdir' ? `${args.path}/.gitkeep` : args.path;
    requireFile(action, target);
    const absolute = await safePath(target, action === 'write');
    if (args.action === 'mkdir') {
      await mkdir(path.dirname(absolute), { recursive: true });
      try {
        await (await open(absolute, 'wx', 0o644)).close();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      return 'Folder created.';
    }
    if (args.action === 'read') {
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_FILE)
          throw new Error('Choose a text file no larger than 25 MiB.');
        return await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
    }
    if (args.action === 'delete') {
      if (!(await lstat(absolute)).isFile())
        throw new Error('Delete individual files; folders cannot be removed recursively.');
      await unlink(absolute);
      return 'File deleted.';
    }
    if (args.content === undefined || Buffer.byteLength(args.content) > MAX_FILE)
      throw new Error('Provide UTF-8 content no larger than 25 MiB.');
    await mkdir(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.${randomUUID()}.writing`;
    try {
      const existing = await lstat(absolute).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      const handle = await open(temporary, 'wx', existing?.mode ? existing.mode & 0o777 : 0o644);
      try {
        await handle.writeFile(args.content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, absolute);
    } finally {
      await unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return 'File saved.';
  }
  return (input: unknown) => {
    const result = pending.then(() => execute(input));
    pending = result.catch(() => {});
    return result;
  };
}
