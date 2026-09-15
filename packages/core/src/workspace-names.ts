import { lock, type Tx } from '../../db';
import type { Principal } from './auth';
import * as resources from './resources';
import { AppError, assert } from './errors';
import { branchName, repositoryBranches } from '../../providers/src/git-repository';
import type { FileRecord } from './files';

/** Names are display metadata. All resource operations continue to address opaque IDs. */
export function workspaceIdentity(name?: string | null, branch?: string | null) {
  const label = name?.trim() || branch?.trim() || null;
  assert(
    !label || label.length <= 151,
    400,
    'invalid_name',
    'Use a worktree name of at most 151 characters.',
  );
  const ref =
    branch?.trim() ||
    (label &&
      label
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9/_.-]+/g, '-')
        .replace(/^[^a-zA-Z0-9]+|[-/.]+$/g, '')) ||
    null;
  if (ref) branchName(ref);
  assert(!label || ref, 400, 'invalid_branch', 'Enter a branch name for this worktree.');
  return { name: label, branch: ref };
}

export async function assertWorkspaceName(tx: Tx, projectId: string, name: string | null, exceptId?: string) {
  if (!name) return;
  const collision = await tx.query(
    "SELECT id FROM workspaces WHERE project_id=$1 AND lower(btrim(data->>'name'))=lower($2) AND COALESCE(data->>'deleted','false')='false' AND ($3::uuid IS NULL OR id<>$3)",
    [projectId, name, exceptId ?? null],
  );
  assert(!collision.rowCount, 409, 'name_exists', 'A worktree with this name already exists.');
}

/** A branch list reflects saved repository refs, never an unauthenticated remote lookup. */
export async function projectBranches(tx: Tx, p: Principal, projectId: string) {
  await resources.get(tx, 'projects', projectId, p);
  const rows = await tx.query(
    "SELECT id,data FROM workspaces WHERE project_id=$1 AND COALESCE(data->>'deleted','false')='false' ORDER BY updated_at DESC",
    [projectId],
  );
  const branches = new Map<string, { name: string; workspace_id: string; ref: string }>();
  for (const row of rows.rows) {
    const data = row.data as resources.Document<'workspaces'>;
    for (const branch of await repositoryBranches((data.git_files ?? []) as FileRecord[]))
      if (!branches.has(branch.name)) branches.set(branch.name, { ...branch, workspace_id: String(row.id) });
    if (typeof data.branch === 'string' && !branches.has(data.branch))
      branches.set(data.branch, {
        name: data.branch,
        ref: `refs/heads/${data.branch}`,
        workspace_id: String(row.id),
      });
  }
  return [...branches.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function workspaceOptions(tx: Tx, p: Principal, projectId: string, query: URLSearchParams) {
  const branches = await projectBranches(tx, p, projectId);
  try {
    const identity = workspaceIdentity(query.get('name'), query.get('branch'));
    await assertWorkspaceName(tx, projectId, identity.name);
    const exists = branches.some((branch) => branch.name === identity.branch);
    return { branches, name: identity.name, branch: identity.branch, valid: true, branch_exists: exists };
  } catch (error) {
    if (!(error instanceof AppError) || ![400, 409].includes(error.status)) throw error;
    return {
      branches,
      valid: false,
      message: error instanceof Error ? error.message : 'Choose another name or branch.',
    };
  }
}

export async function renameWorkspace(tx: Tx, p: Principal, id: string, name: string) {
  const workspace = await resources.get(tx, 'workspaces', id, p);
  await lock(tx, `project-workspaces:${workspace.project_id}`);
  const label = name.trim();
  assert(label, 400, 'invalid_name', 'Enter a worktree name.');
  await assertWorkspaceName(tx, String(workspace.project_id), label, id);
  return resources.update(tx, 'workspaces', id, { name: label });
}
