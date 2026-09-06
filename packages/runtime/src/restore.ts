import { createHash } from 'node:crypto';
import { chown, lstat, mkdir, open, readFile, readdir, rename, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, relativePath, type SnapshotEntry } from './manifest';

/** Restore into a new, unstarted VM only. Links are created last so they cannot redirect a write. */
export async function restoreSnapshot(
  directory: string,
  roots: { workspace: string; home: string },
  uid?: number,
) {
  const entries: SnapshotEntry[] = [];
  for (const file of (await readdir(directory)).filter((f) => /^page-\d+\.json$/.test(f)).sort())
    entries.push(...JSON.parse(await readFile(path.join(directory, file), 'utf8')));
  const seen = new Set<string>();
  const links = new Set<string>();
  for (const entry of entries) {
    if (!['workspace', 'home'].includes(entry.namespace) || !['file', 'symlink'].includes(entry.type))
      throw new Error('Invalid snapshot entry');
    relativePath(entry.path);
    const name = `${entry.namespace}/${entry.path}`;
    if (seen.has(name)) throw new Error('Duplicate snapshot entry');
    seen.add(name);
    if (entry.type === 'symlink') links.add(name);
  }
  for (const entry of entries) {
    const pieces = `${entry.namespace}/${entry.path}`.split('/');
    for (let i = 1; i < pieces.length; i++)
      if (links.has(pieces.slice(0, i).join('/')))
        throw new Error('Snapshot entry descends through a symlink');
  }
  for (const entry of [
    ...entries.filter((e) => e.type === 'file'),
    ...entries.filter((e) => e.type === 'symlink'),
  ]) {
    const root = roots[entry.namespace],
      dest = path.join(root, entry.path);
    const parents = entry.path.split('/').slice(0, -1);
    let parent = root;
    for (const segment of ['', ...parents]) {
      parent = path.join(parent, segment);
      await mkdir(parent, { recursive: true });
      if (!(await lstat(parent)).isDirectory()) throw new Error('Restore parent is not a directory');
      if (uid !== undefined) await chown(parent, uid, uid);
    }
    const temp = `${dest}.${crypto.randomUUID()}.restore`;
    const hash = createHash('sha256');
    let size = 0;
    const handle = await open(temp, 'wx', entry.mode & 0o777);
    const linkBytes: Buffer[] = [];
    try {
      for (const chunk of entry.chunks) {
        if (!/^[a-f0-9]{64}$/.test(chunk.hash)) throw new Error('Invalid chunk hash');
        const bytes = await readFile(path.join(directory, 'chunks', chunk.hash));
        if (bytes.length !== chunk.size || createHash('sha256').update(bytes).digest('hex') !== chunk.hash)
          throw new Error('Restore chunk integrity failure');
        hash.update(bytes);
        size += bytes.length;
        if (entry.type === 'file') await handle.writeFile(bytes);
        else {
          if (size > 4096) throw new Error('Symlink target too long');
          linkBytes.push(bytes);
        }
      }
      if (hash.digest('hex') !== entry.sha256 || size !== entry.size)
        throw new Error('Restore file integrity failure');
      await handle.sync();
      if (uid !== undefined) await handle.chown(uid, uid);
    } finally {
      await handle.close();
    }
    if (entry.type === 'symlink') {
      await unlink(temp);
      await symlink(Buffer.concat(linkBytes).toString(), temp);
    }
    await rename(temp, dest);
  }
}

if (process.argv[1]?.endsWith('/restore.mjs')) {
  let claimed = true;
  try {
    await mkdir('/platform-control/restore.lock');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') claimed = false;
    else throw error;
  }
  if (claimed)
    try {
      await restoreSnapshot(
        '/platform-control/restore',
        { workspace: '/workspace', home: '/agent-home' },
        10001,
      );
      await atomicJSON('/platform-control/restore-result.json', { ok: true });
    } catch {
      await atomicJSON('/platform-control/restore-result.json', {
        ok: false,
        code: 'restore_integrity_failure',
      });
      process.exitCode = 1;
    }
}
