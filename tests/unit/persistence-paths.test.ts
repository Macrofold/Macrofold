import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isPersistentPath, mayContainPersistentPath } from '../../packages/runtime/src/persistence-paths';
import { captureSnapshot } from '../../packages/runtime/src/manifest';
import { restoreSnapshot } from '../../packages/runtime/src/restore';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
// Expected paths are independent of the registry: upgrades must retain actual
// conversation stores, committed SQLite WAL content, learned memory and assets.
const cases = [
  {
    harness: 'codex',
    paths: [
      '.codex/sessions/history.jsonl',
      '.codex/memories/facts.md',
      '.codex/memories_1.sqlite',
      '.codex/state_5.sqlite-wal',
      '.codex/goals_1.sqlite-journal',
      '.agents/skills/research/SKILL.md',
    ],
    secret: '.codex/config.toml',
  },
  {
    harness: 'claude-code',
    paths: [
      '.claude/projects/project/chat.jsonl',
      '.claude/projects/project/memory/MEMORY.md',
      '.claude/projects/project/tool-results/result.txt',
      '.claude/plans/plan.md',
      '.claude/skills/research/SKILL.md',
    ],
    secret: '.claude/.credentials.json',
  },
  {
    harness: 'opencode',
    paths: [
      '.local/share/opencode/opencode.db',
      '.local/share/opencode/opencode.db-wal',
      '.local/share/opencode/opencode.db-shm',
      '.local/share/opencode/tool-output/result.txt',
      '.config/opencode/skills/research/SKILL.md',
      '.config/opencode/opencode.json',
    ],
    secret: '.local/share/opencode/auth.json',
  },
  {
    harness: 'hermes',
    paths: [
      '.hermes/state.db',
      '.hermes/state.db-journal',
      '.hermes/memories/MEMORY.md',
      '.hermes/skills/research/SKILL.md',
      '.hermes/SOUL.md',
    ],
    secret: '.hermes/config.yaml',
  },
  {
    harness: 'deepseek',
    paths: ['.dsh/sessions/project/session/session.v3.jsonl'],
    secret: '.runtime-transient/dsh/runtime.json',
  },
  {
    harness: 'pi',
    paths: [
      '.pi/agent/sessions/history.jsonl',
      '.pi/agent/skills/research/SKILL.md',
      '.pi/agent/AGENTS.md',
      '.pi/agent/SYSTEM.md',
    ],
    secret: '.pi/agent/auth.json',
  },
] as const;

describe('explicit native home persistence', () => {
  it.each(cases)(
    '$harness round-trips declared state and every worktree file, ignoring undeclared home bytes',
    async ({ harness, paths, secret }) => {
      const root = await mkdtemp(path.join(tmpdir(), 'platform-home-persistence-'));
      directories.push(root);
      const source = { harness, workspace: path.join(root, 'worktree'), home: path.join(root, 'home') };
      const files = [
        ...paths.map((name) => ({ namespace: 'home' as const, path: name, content: `durable ${name}` })),
        ...['.git/HEAD', 'node_modules/user-code.js', '.unknown-runtime/install-v2/package.js'].map(
          (name) => ({ namespace: 'workspace' as const, path: name, content: `worktree ${name}` }),
        ),
      ];
      const ephemeral = [
        '.unknown-runtime/install-v2/package.js',
        '.unknown-runtime/downloads-v2/data',
        secret,
      ];
      for (const file of [
        ...files,
        ...ephemeral.map((name) => ({ namespace: 'home' as const, path: name, content: 'disposable' })),
      ]) {
        const destination = path.join(source[file.namespace], file.path);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, file.content);
      }
      const expected = files;
      const snapshot = path.join(root, 'snapshot');
      const index = await captureSnapshot(source, snapshot, { bytes: 10000, entries: expected.length });
      expect(index.entries.map((e) => `${e.namespace}/${e.path}`).sort()).toEqual(
        expected.map((f) => `${f.namespace}/${f.path}`).sort(),
      );
      const first = index.entries[0];
      expect(first).toBeDefined();
      // The control plane or an earlier capture may supply undeclared objects. No
      // reads of their missing chunks should be needed, but path validation remains.
      const ignored = {
        ...first,
        namespace: 'home' as const,
        path: '.another-unknown-cache/blob',
        sha256: '0'.repeat(64),
        chunks: [{ hash: '0'.repeat(64), size: 5 }],
        size: 5,
      };
      index.entries.push(ignored);
      await writeFile(path.join(snapshot, 'page-0.json'), JSON.stringify(index.entries));
      const target = {
        harness,
        workspace: path.join(root, 'restored-worktree'),
        home: path.join(root, 'restored-home'),
      };
      await restoreSnapshot(snapshot, target);
      for (const file of expected)
        expect(await readFile(path.join(target[file.namespace], file.path), 'utf8')).toBe(file.content);
      for (const name of ['.unknown-runtime/install-v2/package.js', ignored.path, secret])
        await expect(readFile(path.join(target.home, name))).rejects.toMatchObject({ code: 'ENOENT' });
      ignored.path = '.another-unknown-cache/../escape';
      await writeFile(path.join(snapshot, 'page-0.json'), JSON.stringify(index.entries));
      await expect(restoreSnapshot(snapshot, target)).rejects.toThrow('unsafe_snapshot_path');
    },
  );

  it.each(cases)(
    '$harness keeps exact boundaries, prunes unknown roots and refuses credentials',
    ({ harness, paths, secret }) => {
      for (const name of paths) expect(isPersistentPath(harness, 'home', name)).toBe(true);
      for (const name of [secret, `${secret}.backup`, '.unknown-runtime', '.unknown-runtime/package.js']) {
        expect(isPersistentPath(harness, 'home', name)).toBe(false);
        expect(mayContainPersistentPath(harness, 'home', name)).toBe(false);
        expect(isPersistentPath(harness, 'workspace', name)).toBe(true);
      }
    },
  );

  it('traverses declared ancestors without capturing files or following links at those ancestors', async () => {
    expect(mayContainPersistentPath('opencode', 'home', '.local')).toBe(true);
    expect(isPersistentPath('opencode', 'home', '.local')).toBe(false);
    expect(isPersistentPath('codex', 'home', '.local/share/opencode/opencode.db')).toBe(false);
    expect(isPersistentPath('opencode', 'home', '.local/share/opencode/opencode.db-backup')).toBe(false);
    expect(mayContainPersistentPath('codex', 'home', '.codex/sessions-backup')).toBe(false);
    const root = await mkdtemp(path.join(tmpdir(), 'platform-home-symlink-'));
    directories.push(root);
    const roots = {
      harness: 'opencode' as const,
      workspace: path.join(root, 'worktree'),
      home: path.join(root, 'home'),
    };
    await mkdir(roots.workspace);
    await mkdir(roots.home);
    await mkdir(path.join(root, 'outside/share/opencode'), { recursive: true });
    await writeFile(path.join(root, 'outside/share/opencode/opencode.db'), 'outside content');
    await symlink(path.join(root, 'outside'), path.join(roots.home, '.local'));
    expect((await captureSnapshot(roots, path.join(root, 'snapshot'))).entries).toEqual([]);
  });
});
