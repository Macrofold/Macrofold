import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const sqliteCompanions = ['-wal', '-shm', '-journal'] as const;
const MAX_COPY_BYTES = 256 * 1024 * 1024;

// Python's bundled SQLite runs out of process, without harness imports or user
// code. SHM is rebuilt from the copied WAL. No connection touches the source DB.
const normalize = `
import sqlite3, sys
db = sqlite3.connect(sys.argv[1], timeout=0)
try:
    db.execute('PRAGMA trusted_schema=OFF')
    result = db.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
    if result[0] != 0:
        raise RuntimeError('checkpoint_busy')
    if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
        raise RuntimeError('checkpoint_invalid')
finally:
    db.close()
`;

/** Optional optimization after writers are quiescent, never a persistence gate.
 * On any error retain the original DB + sidecars. Worktree DBs are not normalized.
 * See docs/features/execution/runtime.md#native-home-persistence. */
export async function normalizedSqliteCopy(source: string, output: string) {
  const directory = await mkdtemp(path.join(output, 'sqlite-'));
  const database = path.join(directory, 'state.db');
  const cleanup = () => rm(directory, { recursive: true, force: true });
  let total = 0;
  try {
    for (const suffix of ['', ...sqliteCompanions]) {
      // NOFOLLOW/NONBLOCK also prevent a crafted symlink/FIFO from escaping or hanging capture.
      const input = await open(
        source + suffix,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      ).catch((error: NodeJS.ErrnoException) => {
        if (suffix && error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (!input) continue;
      try {
        const stat = await input.stat();
        total += stat.size;
        if (!stat.isFile() || total > MAX_COPY_BYTES) throw new Error('sqlite_copy_limit');
        // The WAL index contains process state; SQLite reconstructs it on the private copy.
        if (suffix === '-shm') continue;
        const target = await open(database + suffix, 'wx', 0o600);
        try {
          const buffer = Buffer.alloc(1024 * 1024);
          let copied = 0;
          for (;;) {
            const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
            if (!bytesRead) break;
            copied += bytesRead;
            if (copied > stat.size) throw new Error('sqlite_source_changed');
            await target.writeFile(buffer.subarray(0, bytesRead));
          }
          if (copied !== stat.size) throw new Error('sqlite_source_changed');
        } finally {
          await target.close();
        }
      } finally {
        await input.close();
      }
    }
    await promisify(execFile)('python3', ['-I', '-c', normalize, database], {
      timeout: 10_000,
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024,
    });
    // A successful checkpoint cannot leave committed pages in a WAL/journal.
    // Do not trust an unfamiliar SQLite version's cleanup behavior silently.
    for (const suffix of ['-wal', '-journal']) {
      const handle = await open(database + suffix, 'r').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (handle) {
        try {
          if ((await handle.stat()).size !== 0) throw new Error('sqlite_companion_remaining');
        } finally {
          await handle.close();
        }
      }
    }
    return { database, cleanup };
  } catch {
    await cleanup();
    return undefined;
  }
}
