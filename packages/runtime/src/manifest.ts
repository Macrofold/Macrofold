import { createHash } from 'node:crypto';
import { constants, watch } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, readlink, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  isPersistentPath,
  mayContainPersistentPath,
  nativeDatabases,
  type SnapshotRoots,
} from './persistence-paths';
import { normalizedSqliteCopy, sqliteCompanions } from './sqlite-snapshot';

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

/** The supervisor calls this only after the current handle's writers are stopped or safely suspended.
 * Symlinks are recorded as links, never traversed. Chunks bound control-plane memory use. */
async function captureSnapshotOwned(
  roots: SnapshotRoots,
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
  let visited = 0;
  for (const namespace of ['workspace', 'home'] as const) {
    const root = roots[namespace];
    const normalized = new Set<string>();
    const walk = async (directory: string): Promise<void> => {
      for (const name of (await readdir(directory)).sort()) {
        if (++visited > Math.max(1000, limits.entries * 2)) throw new Error('checkpoint_traversal_limit');
        const absolute = path.join(directory, name),
          relative = relativePath(path.relative(root, absolute));
        if (!mayContainPersistentPath(roots.harness, namespace, relative)) continue;
        const stat = await lstat(absolute);
        if (stat.isDirectory()) {
          await walk(absolute);
          continue;
        }
        if (!isPersistentPath(roots.harness, namespace, relative)) continue;
        if (normalized.has(relative)) continue;
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
          const copy =
            namespace === 'home' && nativeDatabases(roots.harness).includes(relative)
              ? await normalizedSqliteCopy(absolute, output)
              : undefined;
          try {
            const handle = await open(copy?.database || absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
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
            if (copy) for (const suffix of sqliteCompanions) normalized.add(relative + suffix);
          } finally {
            await copy?.cleanup();
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

let captures = 0;
const captureWaiters: (() => void)[] = [];
export async function captureSnapshot(
  roots: SnapshotRoots,
  output: string,
  limits = { bytes: 10 * 1024 ** 3, entries: 100_000 },
): Promise<SnapshotIndex> {
  if (
    !Number.isSafeInteger(limits.bytes) ||
    limits.bytes < 0 ||
    !Number.isSafeInteger(limits.entries) ||
    limits.entries < 0
  )
    throw new Error('checkpoint_invalid_limits');
  if (captures >= 2) await new Promise<void>((resolve) => captureWaiters.push(resolve));
  else captures++;
  try {
    return await captureSnapshotOwned(roots, output, limits);
  } finally {
    const next = captureWaiters.shift();
    if (next) next();
    else captures--;
  }
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

/** Watch before reading so a write between the initial probe and registration
 * cannot be missed. The deadline is repair, not a delay added to ready output. */
export async function waitForRuntimeEvents(directory: string, offset: number, waitMs: number) {
  if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 1000) throw new Error('invalid_probe_wait');
  let resolveChange: (() => void) | undefined;
  const changed = new Promise<void>((resolve) => {
    resolveChange = resolve;
  });
  const wake = () => resolveChange?.();
  const watcher = watch(directory, { persistent: false }, wake);
  watcher.once('error', wake);
  const timeout = setTimeout(wake, waitMs);
  timeout.unref();
  try {
    const initial = await probeRuntime(directory, offset);
    if (initial.events.length || initial.result || !waitMs) return initial;
    await changed;
    return await probeRuntime(directory, offset);
  } finally {
    clearTimeout(timeout);
    watcher.close();
  }
}
