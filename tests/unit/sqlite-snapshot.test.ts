import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureSnapshot } from '../../packages/runtime/src/manifest';
import { restoreSnapshot } from '../../packages/runtime/src/restore';

it('folds committed WAL pages into a copied native DB without changing the source or worktree DBs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sqlite-snapshot-'));
  const roots = { harness: 'opencode' as const, workspace: path.join(root, 'w'), home: path.join(root, 'h') };
  const relative = '.local/share/opencode/opencode.db';
  const file = path.join(roots.home, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(roots.workspace);
  const db = new DatabaseSync(file);
  try {
    db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE messages(id INTEGER PRIMARY KEY, text TEXT)',
    );
    const insert = db.prepare('INSERT INTO messages(text) VALUES(?)');
    for (let i = 0; i < 100; i++) insert.run(`turn ${i}`);
    const originals = await Promise.all(['', '-wal', '-shm'].map((suffix) => readFile(file + suffix)));
    await writeFile(path.join(roots.workspace, 'user.db-wal'), 'user-owned bytes');
    const output = path.join(root, 'capture');
    const index = await captureSnapshot(roots, output);
    expect(index.entries.filter((e) => e.namespace === 'home').map((e) => e.path)).toEqual([relative]);
    expect(index.totalBytes).toBeLessThan(originals.reduce((total, bytes) => total + bytes.length, 0) / 2);
    expect(await readdir(output)).toEqual(expect.arrayContaining(['chunks', 'index.json']));
    expect((await readdir(output)).some((name) => name.startsWith('sqlite-'))).toBe(false);
    for (const [i, suffix] of ['', '-wal', '-shm'].entries())
      expect((await readFile(file + suffix)).equals(originals[i])).toBe(true);
    await writeFile(path.join(output, 'page-0.json'), JSON.stringify(index.entries));
    const restored = {
      harness: roots.harness,
      workspace: path.join(root, 'rw'),
      home: path.join(root, 'rh'),
    };
    await restoreSnapshot(output, restored);
    const copy = new DatabaseSync(path.join(restored.home, relative));
    try {
      expect(copy.prepare('SELECT * FROM messages ORDER BY id').all()).toEqual(
        db.prepare('SELECT * FROM messages ORDER BY id').all(),
      );
      expect(copy.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' });
    } finally {
      copy.close();
    }
    expect(await readFile(path.join(restored.workspace, 'user.db-wal'), 'utf8')).toBe('user-owned bytes');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['corrupt', 'symlink'])(
  'preserves original database and companions when normalization cannot be trusted (%s)',
  async (mode) => {
    const root = await mkdtemp(path.join(tmpdir(), 'sqlite-fallback-'));
    try {
      const roots = {
        harness: 'opencode' as const,
        workspace: path.join(root, 'w'),
        home: path.join(root, 'h'),
      };
      const relative = '.local/share/opencode/opencode.db';
      const file = path.join(roots.home, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await mkdir(roots.workspace);
      await writeFile(file, 'original database bytes');
      await writeFile(file + '-wal', 'original WAL bytes');
      if (mode === 'symlink') await symlink('opencode.db-wal', file + '-shm');
      const output = path.join(root, 'capture');
      const index = await captureSnapshot(roots, output);
      expect(index.entries.map((e) => e.path)).toContain(relative + '-wal');
      for (const entry of index.entries.filter((e) => e.type === 'file')) {
        const bytes = Buffer.concat(
          await Promise.all(entry.chunks.map((chunk) => readFile(path.join(output, 'chunks', chunk.hash)))),
        );
        expect(bytes.equals(await readFile(path.join(roots.home, entry.path)))).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
