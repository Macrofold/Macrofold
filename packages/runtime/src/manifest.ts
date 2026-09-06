import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, readlink, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const CHUNK_BYTES = 4 * 1024 * 1024;
export type SnapshotEntry = {
  namespace: 'workspace' | 'home';
  path: string;
  type: 'file' | 'symlink';
  size: number;
  sha256: string;
  mode: number;
  modifiedAt: string;
  chunks: { hash: string; size: number }[];
};
export type SnapshotIndex = { version: 1; entries: SnapshotEntry[]; totalBytes: number; createdAt: string };
export async function atomicJSON(destination: string, value: unknown) {
  const temp = `${destination}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value), { mode: 0o640 });
  await rename(temp, destination);
}
export function relativePath(value: string) {
  if (
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.split('/').some((p) => !p || p === '..' || p === '.')
  )
    throw new Error('unsafe_snapshot_path');
  return value;
}

/** The supervisor calls this only after every process belonging to the agent UID has exited.
 * Symlinks are recorded as links, never traversed. Chunks bound control-plane memory use. */
export async function captureSnapshot(
  roots: { workspace: string; home: string },
  output: string,
  limits = { bytes: 10 * 1024 ** 3, entries: 100_000 },
): Promise<SnapshotIndex> {
  await mkdir(path.join(output, 'chunks'), { recursive: true, mode: 0o2750 });
  const index: SnapshotIndex = {
    version: 1,
    entries: [],
    totalBytes: 0,
    createdAt: new Date().toISOString(),
  };
  const saveChunk = async (bytes: Buffer) => {
    const hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(output, 'chunks', hash), bytes, { mode: 0o640 });
    return { hash, size: bytes.length };
  };
  for (const namespace of ['workspace', 'home'] as const) {
    const root = roots[namespace];
    const walk = async (directory: string): Promise<void> => {
      for (const name of (await readdir(directory)).sort()) {
        const absolute = path.join(directory, name),
          relative = relativePath(path.relative(root, absolute));
        const stat = await lstat(absolute);
        if (stat.isDirectory()) {
          await walk(absolute);
          continue;
        }
        // Runtime sockets and FIFOs have no persistent file content and cannot be restored meaningfully.
        if (!stat.isFile() && !stat.isSymbolicLink()) continue;
        if (index.entries.length >= limits.entries) throw new Error('checkpoint_entry_limit');
        const hash = createHash('sha256');
        const chunks: SnapshotEntry['chunks'] = [];
        let size = 0;
        const add = async (bytes: Buffer) => {
          size += bytes.length;
          index.totalBytes += bytes.length;
          if (index.totalBytes > limits.bytes) throw new Error('checkpoint_storage_limit');
          hash.update(bytes);
          chunks.push(await saveChunk(bytes));
        };
        if (stat.isSymbolicLink()) await add(Buffer.from(await readlink(absolute)));
        else {
          const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const bytes = Buffer.alloc(CHUNK_BYTES);
            while (true) {
              const next = await handle.read(bytes, 0, bytes.length, null);
              if (!next.bytesRead) break;
              await add(bytes.subarray(0, next.bytesRead));
            }
          } finally {
            await handle.close();
          }
        }
        index.entries.push({
          namespace,
          path: relative,
          type: stat.isSymbolicLink() ? 'symlink' : 'file',
          size,
          sha256: hash.digest('hex'),
          mode: stat.mode & 0o777,
          modifiedAt: stat.mtime.toISOString(),
          chunks,
        });
      }
    };
    await walk(root);
  }
  await atomicJSON(path.join(output, 'index.json'), index);
  return index;
}

/** A bounded probe avoids replaying the entire event log on each Workflow poll. */
export async function probeRuntime(directory: string, offset: number, maxBytes = 128 * 1024) {
  const optionalJSON = async (name: string) => {
    try {
      return JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  };
  const events: Record<string, unknown>[] = [];
  let nextOffset = offset;
  try {
    const handle = await open(path.join(directory, 'events.jsonl'), 'r');
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, offset);
      const end = buffer.subarray(0, bytesRead).lastIndexOf(10);
      if (end >= 0) {
        for (const line of buffer.subarray(0, end).toString('utf8').split('\n'))
          if (line) events.push(JSON.parse(line));
        nextOffset += end + 1;
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    events,
    nextOffset,
    status: await optionalJSON('status.json'),
    result: await optionalJSON('result.json'),
    input: await optionalJSON('input.json'),
  };
}
