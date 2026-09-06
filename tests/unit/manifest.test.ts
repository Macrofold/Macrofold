import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, symlink, readlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureSnapshot, probeRuntime, CHUNK_BYTES } from '../../packages/runtime/src/manifest';
import { restoreSnapshot } from '../../packages/runtime/src/restore';

describe('portable filesystem checkpoints', () => {
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
    expect(await readFile(path.join(restored.workspace, 'large.bin'))).toEqual(large);
    expect((await stat(path.join(restored.workspace, 'large.bin'))).mode & 0o777).toBe(0o755);
    expect(await readlink(path.join(restored.workspace, 'external-link'))).toBe('/does/not/exist');
    expect(await readFile(path.join(restored.home, 'session.json'), 'utf8')).toBe('native history');
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
