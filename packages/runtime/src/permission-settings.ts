import type { PermissionConfig } from '@opencode-ai/sdk/v2';

/** Native settings gate alternate execution paths. File patterns themselves are
 * evaluated by permissionFileTools: native glob precedence and shell-based tools
 * cannot represent the intersection of arbitrary policies without widening it. */
export function codexPermissionSettings(): Record<string, unknown> {
  const disabled = [
    'shell_tool',
    'unified_exec',
    'shell_snapshot',
    'multi_agent',
    'multi_agent_v2',
    'hooks',
    'plugins',
    'apps',
    'browser_use',
    'browser_use_external',
    'computer_use',
    'in_app_browser',
    'in_app_local_automation',
    'workspace_dependencies',
    'view_image',
    'image_generation',
    'code_mode',
    'request_permissions_tool',
    'skill_mcp_dependency_install',
    'skill_search',
    'tool_suggest',
    'artifact',
    'memories',
  ];
  return {
    default_permissions: 'worktree_guarded',
    ...Object.fromEntries(disabled.map((feature) => [`features.${feature}`, false])),
    'features.skip_host_skill_discovery': true,
  };
}

/** Use TOML for path keys: Codex's CLI dotted-key overrides treat quotes as
 * literal characters. This file is regenerated and excluded from checkpoints. */
export function codexPermissionProfile(workspace: string) {
  return `[permissions.worktree_guarded.filesystem]
":minimal" = "read"
":workspace_roots" = "deny"
[permissions.worktree_guarded.network]
enabled = false
[projects.${JSON.stringify(workspace)}]
trust_level = "untrusted"
`;
}

export function openCodePermissionSettings(toolGrants: boolean): PermissionConfig {
  return {
    '*': 'deny',
    question: 'allow',
    worktree_worktree_files: 'allow',
    ...(toolGrants ? { 'platform_*': 'allow' as const } : {}),
  };
}

/** sdk-minimal registers these tool producers explicitly. Disable both shell
 * dialects and the bare filesystem editor; keep the native agent/session loop. */
export function deepSeekPermissionSettings() {
  return ['persistent-bash', 'persistent-pwsh', 'str-replace-editor', 'terminal-bash', 'terminal-pwsh'].map(
    (id) => ({ id, disabled: true }),
  );
}
