import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, symlink, readlink, stat, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureSnapshot, probeRuntime, CHUNK_BYTES } from '../../packages/runtime/src/manifest';
import { restoreSnapshot } from '../../packages/runtime/src/restore';

describe('portable filesystem checkpoints', () => {
  it('excludes native credentials and their backups while preserving resumable session history', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-auth-checkpoint-'));
    try {
      const roots = { workspace: path.join(root, 'workspace'), home: path.join(root, 'home') };
      await mkdir(roots.workspace);
      const secretPaths = [
        '.claude/.credentials.json',
        '.claude/.credentials.json.tmp',
        '.claude.json',
        '.claude/backups/.claude.json.backup.1',
        '.codex/auth.json',
        '.codex/config.toml',
        '.local/share/opencode/auth.json',
        '.runtime-config.json',
        '.runtime-transient/dsh/runtime.json',
        '.pi/agent/auth.json',
        '.hermes/config.yaml',
        '.hermes/.env',
        '.hermes/auth.json',
      ];
      for (const name of [...secretPaths, '.claude/projects/session.jsonl']) {
        const dest = path.join(roots.home, name);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, secretPaths.includes(name) ? 'synthetic-auth-only' : 'conversation fixture');
      }
      await writeFile(path.join(roots.workspace, 'document.txt'), 'project fixture');
      const output = path.join(root, 'capture');
      const snapshot = await captureSnapshot(roots, output);
      expect(snapshot.entries.map((entry) => `${entry.namespace}/${entry.path}`)).toEqual([
        'workspace/document.txt',
        'home/.claude/projects/session.jsonl',
      ]);
      expect(await readdir(path.join(output, 'chunks'))).not.toContain(
        createHash('sha256').update('synthetic-auth-only').digest('hex'),
      );
      await writeFile(path.join(output, 'page-0.json'), JSON.stringify(snapshot.entries));
      await restoreSnapshot(output, {
        workspace: path.join(root, 'new-workspace'),
        home: path.join(root, 'new-home'),
      });
      expect(await readFile(path.join(root, 'new-home/.claude/projects/session.jsonl'), 'utf8')).toBe(
        'conversation fixture',
      );
      await writeFile(
        path.join(output, 'page-0.json'),
        JSON.stringify([...snapshot.entries, { ...snapshot.entries[1], path: '.claude/.credentials.json' }]),
      );
      await expect(
        restoreSnapshot(output, {
          workspace: path.join(root, 'rejected-workspace'),
          home: path.join(root, 'rejected-home'),
        }),
      ).rejects.toThrow('native authentication');
      await expect(stat(path.join(root, 'rejected-workspace'))).rejects.toMatchObject({ code: 'ENOENT' });
      await writeFile(
        path.join(output, 'page-0.json'),
        JSON.stringify([{ ...snapshot.entries[1], path: '.codex/config.toml' }]),
      );
      await expect(
        restoreSnapshot(output, {
          workspace: path.join(root, 'rejected-workspace'),
          home: path.join(root, 'rejected-home'),
        }),
      ).rejects.toThrow('native authentication');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('round-trips multi-chunk files, executable mode, symlinks, ignored Git data and native session state', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-checkpoint-'));
    const roots = { workspace: path.join(root, 'workspace'), home: path.join(root, 'home') };
    await mkdir(path.join(roots.workspace, '.git'), { recursive: true });
    await mkdir(roots.home);
    const large = Buffer.alloc(CHUNK_BYTES + 123, 42);
    await writeFile(path.join(roots.workspace, 'large.bin'), large, { mode: 0o755 });
    await writeFile(path.join(roots.workspace, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(path.join(roots.home, 'session.json'), 'native history');
    await symlink('large.bin', path.join(roots.workspace, 'relative-link'));
    await symlink('/does/not/exist', path.join(roots.workspace, 'external-link'));
    const output = path.join(root, 'snapshot');
    const index = await captureSnapshot(roots, output);
    expect(index.entries.find((e) => e.path === 'large.bin')?.chunks).toHaveLength(2);
    await writeFile(path.join(output, 'page-0.json'), JSON.stringify(index.entries));
    const restored = {
      workspace: path.join(root, 'restored-workspace'),
      home: path.join(root, 'restored-home'),
    };
    await restoreSnapshot(output, restored);
    // Compare every byte natively; a generic deep matcher walks millions of
    // indexed properties and can exhaust the test deadline on a busy host.
    expect((await readFile(path.join(restored.workspace, 'large.bin'))).equals(large)).toBe(true);
    expect((await stat(path.join(restored.workspace, 'large.bin'))).mode & 0o777).toBe(0o755);
    expect(await readlink(path.join(restored.workspace, 'external-link'))).toBe('/does/not/exist');
    expect(await readFile(path.join(restored.home, 'session.json'), 'utf8')).toBe('native history');
    expect(await readFile(path.join(restored.workspace, '.git', 'HEAD'), 'utf8')).toBe(
      'ref: refs/heads/main\n',
    );
  });
  it('does not consume a partial JSONL frame or split a multibyte character at a stream cursor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-probe-'));
    const line = JSON.stringify({ sequence: 1, type: 'output.delta', data: { text: 'Hello 🌏' } }) + '\n';
    await writeFile(path.join(root, 'events.jsonl'), line + '{"sequence":2');
    const probe = await probeRuntime(root, 0);
    expect(probe.events).toHaveLength(1);
    expect(probe.nextOffset).toBe(Buffer.byteLength(line));
    expect((await probeRuntime(root, probe.nextOffset)).events).toHaveLength(0);
  });
  it('hands bounded capture slots to queued captures, including after failures', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-capture-slots-'));
    try {
      const roots = await Promise.all(
        [0, 1, 2, 3, 4].map(async (n) => {
          const value = { workspace: path.join(root, `w${n}`), home: path.join(root, `h${n}`) };
          await mkdir(value.workspace);
          await mkdir(value.home);
          await writeFile(path.join(value.workspace, 'file.txt'), `capture ${n}`);
          return value;
        }),
      );
      // Two failures occupy both slots first; a leaked slot would leave the queued captures waiting forever.
      const outcomes = await Promise.allSettled(
        roots.map((value, n) =>
          captureSnapshot(value, path.join(root, `out${n}`), {
            bytes: 1024,
            entries: n < 2 ? 0 : 10,
          }),
        ),
      );
      expect(outcomes.map((outcome) => outcome.status)).toEqual([
        'rejected',
        'rejected',
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ]);
      for (const n of [2, 3, 4]) {
        const index = JSON.parse(await readFile(path.join(root, `out${n}`, 'index.json'), 'utf8'));
        expect(index.entries.map((entry: { path: string }) => entry.path)).toEqual(['file.txt']);
        expect(index.totalBytes).toBe(Buffer.byteLength(`capture ${n}`));
      }
      await expect(readFile(path.join(root, 'out0', 'index.json'))).rejects.toThrow();
      const after = await captureSnapshot(roots[0], path.join(root, 'after'));
      expect(after.entries).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects a snapshot that would write through a symlink ancestor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-unsafe-'));
    await writeFile(
      path.join(root, 'page-0.json'),
      JSON.stringify([
        { namespace: 'workspace', path: 'a', type: 'symlink' },
        { namespace: 'workspace', path: 'a/file', type: 'file' },
      ]),
    );
    await expect(
      restoreSnapshot(root, { workspace: path.join(root, 'w'), home: path.join(root, 'h') }),
    ).rejects.toThrow('symlink');
  });
});
