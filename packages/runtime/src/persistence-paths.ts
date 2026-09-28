import type { HarnessName } from '../../contracts/harnesses';
import { isNativeAuthPath } from './auth-paths';

export type SnapshotRoots = { workspace: string; home: string; harness: HarnessName };
type HomePersistence = { directories: readonly string[]; files: readonly string[] };

// A suspended SQLite writer can leave committed history in its WAL. Capture all
// companions together; never open/checkpoint a live harness DB from the supervisor.
const sqlite = (...names: string[]) =>
  names.flatMap((name) => ['', '-wal', '-shm', '-journal'].map((suffix) => name + suffix));

/** Durable native resources for the pinned adapters, not a backup of HOME.
 * Adding/upgrading a harness requires fresh-container continuation acceptance.
 * See docs/features/execution/runtime.md#native-home-persistence. */
const nativeHome: Record<HarnessName, HomePersistence> = {
  codex: {
    directories: [
      '.codex/sessions',
      '.codex/archived_sessions',
      '.codex/memories',
      '.codex/skills',
      '.agents/skills',
    ],
    files: [
      '.codex/AGENTS.md',
      '.codex/AGENTS.override.md',
      '.codex/session_index.jsonl',
      ...sqlite(
        '.codex/state_5.sqlite',
        '.codex/memories_1.sqlite',
        '.codex/goals_1.sqlite',
        '.codex/queue_1.sqlite',
        '.codex/thread_history_1.sqlite',
      ),
    ],
  },
  'claude-code': {
    // Projects include subagent transcripts, auto-memory and large tool results.
    directories: [
      '.claude/projects',
      '.claude/tasks',
      '.claude/todos',
      '.claude/plans',
      '.claude/file-history',
      '.claude/paste-cache',
      '.claude/image-cache',
      '.claude/skills',
      '.claude/commands',
      '.claude/agents',
      '.claude/rules',
      '.claude/agent-memory',
    ],
    files: ['.claude/CLAUDE.md'],
  },
  opencode: {
    // Tool-result overflow and undo snapshots can be referenced by the session DB.
    directories: [
      '.local/share/opencode/tool-output',
      '.local/share/opencode/snapshot',
      '.config/opencode/agents',
      '.config/opencode/commands',
      '.config/opencode/skills',
      '.config/opencode/tools',
      '.config/opencode/plugins',
    ],
    files: [
      ...sqlite('.local/share/opencode/opencode.db'),
      '.config/opencode/opencode.json',
      '.config/opencode/opencode.jsonc',
      '.config/opencode/AGENTS.md',
    ],
  },
  hermes: {
    directories: ['.hermes/sessions', '.hermes/memories', '.hermes/skills'],
    files: [...sqlite('.hermes/state.db'), '.hermes/SOUL.md'],
  },
  deepseek: { directories: ['.dsh/sessions'], files: [] },
  pi: {
    directories: ['.pi/agent/sessions', '.pi/agent/skills'],
    files: [
      '.pi/agent/AGENTS.md',
      '.pi/agent/AGENTS.override.md',
      '.pi/agent/AGENTS.MD',
      '.pi/agent/CLAUDE.md',
      '.pi/agent/CLAUDE.MD',
      '.pi/agent/SYSTEM.md',
      '.pi/agent/APPEND_SYSTEM.md',
    ],
  },
};

export function isPersistentPath(
  harness: HarnessName,
  namespace: 'workspace' | 'home',
  name: string,
): boolean {
  if (namespace === 'workspace') return true;
  if (isNativeAuthPath(namespace, name)) return false;
  const profile = nativeHome[harness];
  return (
    profile.files.includes(name) ||
    profile.directories.some((directory) => name === directory || name.startsWith(`${directory}/`))
  );
}

/** Traverse only durable roots and their ancestors. Ancestors themselves are not
 * durable files/symlinks: following one could capture data outside the home. */
export function mayContainPersistentPath(
  harness: HarnessName,
  namespace: 'workspace' | 'home',
  name: string,
): boolean {
  if (isPersistentPath(harness, namespace, name)) return true;
  if (isNativeAuthPath(namespace, name)) return false;
  const profile = nativeHome[harness];
  return (
    profile.directories.some((entry) => entry.startsWith(`${name}/`)) ||
    profile.files.some((entry) => entry.startsWith(`${name}/`))
  );
}
