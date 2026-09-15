/** Native login state is never session/project content. This is a persistence
 * boundary, not a way to hide secrets from tools sharing the native process UID. */
export function isNativeAuthPath(namespace: string, name: string): boolean {
  if (namespace !== 'home') return false;
  return (
    [
      '.runtime-config.json',
      '.runtime-transient',
      '.pi/agent/auth.json',
      '.hermes/config.yaml',
      '.hermes/.env',
      '.hermes/auth.json',
      '.claude/.credentials.json',
      '.claude.json',
      '.codex/auth.json',
      '.codex/config.toml',
      '.local/share/opencode/auth.json',
    ].some((entry) => name === entry || name.startsWith(entry + '.') || name.startsWith(entry + '/')) ||
    name.startsWith('.claude/backups/')
  );
}
