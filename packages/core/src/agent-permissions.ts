import type { Tx } from '../../db';
import { lock } from '../../db';
import type { AgentPermissions, PermissionLayers } from '../../contracts/permissions';
import { agentPermissionsSchema, permissionLayers, fileAllowed } from '../../contracts/permissions';
import { permissionAdapters } from '../../contracts/permission-adapters';
import type { HarnessName } from '../../contracts/harnesses';
import { assert } from './errors';
import { canonical } from './crypto';
import * as resources from './resources';
import type { FileRecord } from './files';

export function validatePermissions(policy: AgentPermissions | undefined) {
  if (policy === undefined) return;
  const parsed = agentPermissionsSchema.safeParse(policy);
  assert(
    parsed.success,
    400,
    'invalid_permissions',
    'Use relative file/tool glob patterns (*, **, ?) without traversal or negation.',
  );
}
/** Serialize edits and admission. Active agents retain their accepted authority;
 * callers must stop pending runs before changing the enclosing policy. */
export async function editPermissions(tx: Tx, projectId: string, policy: AgentPermissions | undefined) {
  if (policy === undefined) return;
  validatePermissions(policy);
  await lock(tx, `project-permissions:${projectId}`);
  const active = await tx.query(
    "SELECT 1 FROM runs WHERE project_id=$1 AND status IN ('queued','provisioning','running','waiting_for_input','persisting') LIMIT 1",
    [projectId],
  );
  assert(
    !active.rowCount,
    409,
    'permissions_in_use',
    'Stop pending project runs before changing agent permissions.',
  );
}
export async function admitPermissions(
  tx: Tx,
  project: resources.Document<'projects'>,
  workspace: resources.Document<'workspaces'>,
  session: resources.Document<'sessions'>,
  policy: AgentPermissions | undefined,
  harness: HarnessName,
) {
  validatePermissions(policy);
  // Re-read after acquiring the same lock used by project/worktree policy edits.
  await lock(tx, `project-permissions:${project.id}`);
  const currentProject = await resources.get(tx, 'projects', project.id);
  const currentWorkspace = await resources.get(tx, 'workspaces', workspace.id);
  const layers = permissionLayers(
    currentProject.permissions,
    currentWorkspace.permissions,
    policy ?? session.run_permissions,
  );
  try {
    permissionAdapters[harness].translate(layers);
  } catch (error) {
    assert(false, 400, 'permissions_unsupported', (error as Error).message);
  }
  const fingerprint = canonical(layers);
  assert(
    !session.permission_fingerprint || session.permission_fingerprint === fingerprint,
    409,
    'session_permissions_changed',
    'Start a new session after changing permissions. Existing conversation history retains its original access.',
  );
  await resources.update(tx, 'sessions', session.id, {
    permission_fingerprint: fingerprint,
    run_permissions: policy ?? session.run_permissions,
  });
  return layers;
}
/** Hidden inputs remain in durable storage. Check every changed/deleted/new file
 * before accepting output, independently of the native harness's tool checks. */
export function permissionOutput(layers: PermissionLayers, before: FileRecord[], output: FileRecord[]) {
  const visible = before.filter((file) => fileAllowed(layers, 'read', file.path) && file.type !== 'symlink');
  const old = new Map(visible.map((file) => [file.path, file]));
  const next = new Map(output.map((file) => [file.path, file]));
  for (const name of new Set([...old.keys(), ...next.keys()])) {
    const a = old.get(name),
      b = next.get(name);
    if (a?.sha256 === b?.sha256 && a?.type === b?.type && (a?.mode || 0o644) === (b?.mode || 0o644)) continue;
    assert(
      fileAllowed(layers, 'write', name) && b?.type !== 'symlink',
      403,
      'file_permission_denied',
      'Agent output attempted a file change outside its accepted permissions. The previous checkpoint is preserved.',
    );
  }
  return [...before.filter((file) => !old.has(file.path)), ...output];
}
