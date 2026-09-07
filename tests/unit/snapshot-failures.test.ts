import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { captureSnapshot, relativePath, type SnapshotEntry } from '../../packages/runtime/src/manifest';
import { restoreSnapshot } from '../../packages/runtime/src/restore';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-restore-fault-'));
  directories.push(root);
  const source = { workspace: path.join(root, 'source'), home: path.join(root, 'home') };
  await mkdir(source.workspace);
  await mkdir(source.home);
  await writeFile(path.join(source.workspace, 'file.txt'), 'verified new content');
  const snapshot = path.join(root, 'snapshot');
  const index = await captureSnapshot(source, snapshot);
  const target = { workspace: path.join(root, 'target'), home: path.join(root, 'target-home') };
  await mkdir(target.workspace);
  await writeFile(path.join(target.workspace, 'file.txt'), 'retained content');
  const publish = () => writeFile(path.join(snapshot, 'page-0.json'), JSON.stringify(index.entries));
  await publish();
  return { root, source, snapshot, index, target, publish };
}

describe('checkpoint validation and atomic file publication', () => {
  it.each(['', '/absolute', '../escape', 'a/../escape', './a', 'a//b', 'a/', 'a\\b', 'a\0b'])(
    'rejects unsafe snapshot path %j',
    (value) => {
      expect(() => relativePath(value)).toThrow('unsafe_snapshot_path');
    },
  );
  it.each(['hello.txt', '.git/objects/aa/value', 'notes/🌍.md'])('retains legitimate path %s', (value) => {
    expect(relativePath(value)).toBe(value);
  });
  it.each(['bytes', 'chunk-size', 'file-size', 'file-hash', 'missing-chunk', 'chunk-path'] as const)(
    'preserves the destination when %s verification fails',
    async (fault) => {
      const f = await fixture();
      const entry = f.index.entries[0],
        chunk = entry.chunks[0];
      if (fault === 'bytes') await writeFile(path.join(f.snapshot, 'chunks', chunk.hash), 'corrupt');
      if (fault === 'chunk-size') chunk.size++;
      if (fault === 'file-size') entry.size++;
      if (fault === 'file-hash') entry.sha256 = '0'.repeat(64);
      if (fault === 'missing-chunk') await rm(path.join(f.snapshot, 'chunks', chunk.hash));
      if (fault === 'chunk-path') chunk.hash = '../../file.txt';
      await f.publish();
      await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow();
      expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
      expect(await readFile(path.join(f.source.workspace, 'file.txt'), 'utf8')).toBe('verified new content');
    },
  );
  it('rejects duplicate entries before publishing any file', async () => {
    const f = await fixture();
    f.index.entries.push(f.index.entries[0]);
    await f.publish();
    await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow('Duplicate snapshot entry');
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
  });
  it('rejects unknown namespaces before resolving a destination', async () => {
    const f = await fixture();
    f.index.entries[0].namespace = 'outside' as SnapshotEntry['namespace'];
    await f.publish();
    await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow('Invalid snapshot entry');
  });
  it('refuses a symlinked destination root without changing the linked files', async () => {
    const f = await fixture();
    const linkedRoot = path.join(f.root, 'linked-root');
    await symlink(f.target.workspace, linkedRoot);
    await expect(restoreSnapshot(f.snapshot, { ...f.target, workspace: linkedRoot })).rejects.toThrow(
      'Restore parent is not a directory',
    );
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
  });
  it('accepts an exact capture byte allowance and rejects one byte less without publishing an index', async () => {
    const f = await fixture(),
      bytes = Buffer.byteLength('verified new content');
    const exact = await captureSnapshot(f.source, path.join(f.root, 'exact'), { bytes, entries: 1 });
    expect(exact.totalBytes).toBe(bytes);
    const rejected = path.join(f.root, 'rejected');
    await expect(captureSnapshot(f.source, rejected, { bytes: bytes - 1, entries: 1 })).rejects.toThrow(
      'checkpoint_storage_limit',
    );
    await expect(readFile(path.join(rejected, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects an extra entry without publishing a partial checkpoint index', async () => {
    const f = await fixture();
    await writeFile(path.join(f.source.home, 'session.txt'), 'session');
    const output = path.join(f.root, 'entry-limit');
    await expect(captureSnapshot(f.source, output, { bytes: 1000, entries: 1 })).rejects.toThrow(
      'checkpoint_entry_limit',
    );
    await expect(readFile(path.join(output, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('checkpoint transfer and symlink failure branches', () => {
  it('rejects malformed page JSON before changing the destination', async () => {
    const f = await fixture();
    await writeFile(path.join(f.snapshot, 'page-0.json'), '[{"truncated":');
    await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow(SyntaxError);
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
  });
  it('rejects a child beneath a recorded symlink before publishing any file', async () => {
    const f = await fixture();
    f.index.entries.push(
      { ...f.index.entries[0], path: 'linked', type: 'symlink' },
      { ...f.index.entries[0], path: 'linked/child' },
    );
    await f.publish();
    await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow(
      'Snapshot entry descends through a symlink',
    );
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
  });
  it('rejects an oversized verified symlink target without replacing the existing file', async () => {
    const f = await fixture();
    const { createHash } = await import('node:crypto');
    const bytes = Buffer.alloc(4097, 97),
      hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(path.join(f.snapshot, 'chunks', hash), bytes);
    Object.assign(f.index.entries[0], {
      type: 'symlink',
      size: bytes.length,
      sha256: hash,
      chunks: [{ hash, size: bytes.length }],
    });
    await f.publish();
    await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow('Symlink target too long');
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
  });
  it('preserves the destination when an expected chunk has not finished transferring', async () => {
    const f = await fixture(),
      chunk = f.index.entries[0].chunks[0];
    await writeFile(path.join(f.snapshot, 'chunks', chunk.hash), 'verified');
    await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow('Restore chunk integrity failure');
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
    await writeFile(path.join(f.snapshot, 'chunks', chunk.hash), 'verified new content');
    await restoreSnapshot(f.snapshot, f.target);
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('verified new content');
  });
});

it('reads multi-digit pages and ignores files that only resemble page names', async () => {
  const f = await fixture();
  await writeFile(
    path.join(f.snapshot, 'page-10.json'),
    JSON.stringify([{ ...f.index.entries[0], path: 'nested/second.txt' }]),
  );
  for (const name of ['prefix-page-1.json', 'page-2.json.partial'])
    await writeFile(path.join(f.snapshot, name), 'invalid JSON');
  await restoreSnapshot(f.snapshot, f.target);
  expect(await readFile(path.join(f.target.workspace, 'nested/second.txt'), 'utf8')).toBe(
    'verified new content',
  );
});

it('validates entry paths at the restore boundary before writing outside a namespace', async () => {
  const f = await fixture();
  f.index.entries[0].path = '../escape';
  await f.publish();
  await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow('unsafe_snapshot_path');
  await expect(readFile(path.join(f.root, 'escape'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('checks each chunk hash independently of a matching declared full-file hash', async () => {
  const f = await fixture(),
    entry = f.index.entries[0];
  const { createHash } = await import('node:crypto');
  const tampered = Buffer.alloc(entry.size, 88);
  await writeFile(path.join(f.snapshot, 'chunks', entry.chunks[0].hash), tampered);
  entry.sha256 = createHash('sha256').update(tampered).digest('hex');
  await f.publish();
  await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow('Restore chunk integrity failure');
  expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
});

it.each(['prefix', 'suffix'])(
  'rejects a chunk digest with an extra %s even when bytes exist',
  async (side) => {
    const f = await fixture(),
      chunk = f.index.entries[0].chunks[0];
    const bytes = await readFile(path.join(f.snapshot, 'chunks', chunk.hash));
    chunk.hash = side === 'prefix' ? 'x' + chunk.hash : chunk.hash + 'x';
    await writeFile(path.join(f.snapshot, 'chunks', chunk.hash), bytes);
    await f.publish();
    await expect(restoreSnapshot(f.snapshot, f.target)).rejects.toThrow('Invalid chunk hash');
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe('retained content');
  },
);

async function crashAt(mode: string, snapshot: string, roots: { workspace: string; home: string }) {
  const { fork } = await import('node:child_process');
  const child = fork(
    path.resolve('tests/fixtures/filesystem-crash.mjs'),
    [mode, snapshot, roots.workspace, roots.home],
    {
      execArgv: ['--import', 'tsx'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  const exited = once(child, 'exit');
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  let output = '';
  child.stderr!.on('data', (bytes) => {
    output += bytes;
  });
  try {
    const paused = await Promise.race([
      once(child, 'message').then(([message]) => message),
      exited.then(() => {
        throw new Error('Crash fixture exited before barrier: ' + output);
      }),
    ]);
    expect(paused).toEqual({ paused: true });
  } finally {
    clearTimeout(timeout);
    child.kill('SIGKILL');
    await exited;
  }
}
it.each(['before-file', 'after-file'])(
  'recovers a process killed %s publication in an unstarted replacement directory',
  async (mode) => {
    const f = await fixture();
    f.index.entries.push({ ...f.index.entries[0], path: 'second.txt' });
    await f.publish();
    await crashAt(mode, f.snapshot, f.target);
    expect(await readFile(path.join(f.target.workspace, 'file.txt'), 'utf8')).toBe(
      mode === 'before-file' ? 'retained content' : 'verified new content',
    );
    await expect(readFile(path.join(f.target.workspace, 'second.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    // Partial replacement state is never started. A subsequent restore verifies every file again.
    await restoreSnapshot(f.snapshot, f.target);
    for (const name of ['file.txt', 'second.txt'])
      expect(await readFile(path.join(f.target.workspace, name), 'utf8')).toBe('verified new content');
  },
);
it('does not publish a partial capture after process death and rebuilds its index on retry', async () => {
  const f = await fixture(),
    output = path.join(f.root, 'crashed-capture');
  await crashAt('capture', output, f.source);
  await expect(readFile(path.join(output, 'index.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  const result = await captureSnapshot(f.source, output);
  expect(JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8'))).toEqual(result);
  expect(result.entries[0].sha256).toBe(f.index.entries[0].sha256);
  expect(await readFile(path.join(f.source.workspace, 'file.txt'), 'utf8')).toBe('verified new content');
});
