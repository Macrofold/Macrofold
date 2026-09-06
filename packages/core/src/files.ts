import { assert } from './errors';
import * as resources from './resources';
import { lock, type Tx } from '../../db';
import { saveContent, verifyContent } from '../../providers/src/storage';
import type { Principal } from './auth';
import { gitRevision, branchName, withRepository } from '../../providers/src/git-repository';
import { requireStorageCapacity } from './storage-maintenance';
export type FileRecord = {
  path: string;
  type: 'file' | 'symlink';
  key: string;
  sha256: string;
  size_bytes: string;
  modified_at: string;
  git_ignored: boolean;
  mode?: number;
};
/** Files and symlinks cannot also be parent directories. Reject an impossible tree before
 * checkpoint publication; a recoverable Git error must never conceal invalid filesystem state. */
export function assertFileTree(files: Pick<FileRecord, 'path'>[]) {
  const paths = new Set<string>();
  for (const file of files) {
    assert(!paths.has(file.path), 409, 'file_path_conflict', 'A file path appears more than once.');
    paths.add(file.path);
  }
  for (const file of files) {
    const segments = file.path.split('/');
    for (let i = 1; i < segments.length; i++)
      assert(
        !paths.has(segments.slice(0, i).join('/')),
        409,
        'file_path_conflict',
        'A file or symlink conflicts with a parent directory. Remove or rename it first.',
      );
  }
}
export function normalizePath(value: string) {
  assert(
    value.length > 0 &&
      value.length <= 4096 &&
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.includes('\0') &&
      !value.split('/').some((v) => v === '..' || v === '.' || v === ''),
    400,
    'invalid_path',
    'Use a relative path without traversal or empty segments.',
  );
  assert(
    !value.split('/').some((v) => ['.git', '.agent', '.platform-runtime'].includes(v)),
    400,
    'invalid_path',
    'This path is reserved for platform state.',
  );
  return value;
}
export async function workspaceFiles(tx: Tx, workspaceId: string, p?: Principal) {
  const ws = await resources.get(tx, 'workspaces', workspaceId, p);
  return { workspace: ws, files: (ws.files || []) as FileRecord[] };
}
export async function ensureWritable(tx: Tx, workspaceId: string) {
  await lock(tx, `workspace:${workspaceId}`);
  const active = await tx.query(
    "SELECT id FROM runs WHERE workspace_id=$1 AND status IN ('provisioning','running','waiting_for_input','persisting')",
    [workspaceId],
  );
  assert(
    !active.rowCount,
    409,
    'workspace_busy',
    'An agent is writing to this workspace. Wait or cancel it first.',
  );
}
export async function checkpoint(
  tx: Tx,
  p: Principal,
  workspaceId: string,
  label = 'Checkpoint',
  filesOverride?: FileRecord[],
  gitOverride?: FileRecord[],
) {
  const { workspace, files } = await workspaceFiles(tx, workspaceId, p);
  const next = filesOverride || files;
  assertFileTree(next);
  for (const file of next) await verifyContent(file.key, file.sha256);
  let gitState: Record<string, unknown>;
  try {
    gitState = await gitRevision(
      p.organizationId,
      String(workspace.branch || 'main'),
      next,
      gitOverride || ((workspace.git_files || []) as FileRecord[]),
      label,
    );
  } catch (error) {
    // Git failure never discards a recoverable filesystem revision. A user can repair it in a native session.
    gitState = {
      files: next,
      git_files: gitOverride || workspace.git_files || [],
      git_commit: workspace.git_commit,
      git_status: 'attention',
      git_error:
        typeof error === 'object' && error && 'code' in error ? String(error.code) : 'git_checkpoint_failed',
    };
  }
  const snapshot = await resources.create(tx, 'checkpoints', p.organizationId, {
    workspace_id: workspaceId,
    project_id: workspace.project_id,
    label,
    ...gitState,
    consistency: 'quiescent',
    verification: 'verified',
    pinned: false,
    size_bytes: String(
      [...next, ...(gitState.git_files as FileRecord[])].reduce((n, f) => n + Number(f.size_bytes), 0),
    ),
    created_by: p.id,
  });
  await tx.query('UPDATE organizations SET storage_due_at=least(storage_due_at,now()) WHERE id=$1', [
    p.organizationId,
  ]);
  return snapshot;
}
export async function writeFile(
  tx: Tx,
  p: Principal,
  workspaceId: string,
  filePath: string,
  bytes: Buffer,
  revision: string,
) {
  normalizePath(filePath);
  await requireStorageCapacity(tx, p.organizationId);
  assert(
    bytes.length <= 4 * 1024 * 1024,
    413,
    'file_too_large',
    'Use a staged transfer for files larger than 4 MiB.',
  );
  await ensureWritable(tx, workspaceId);
  const { workspace, files } = await workspaceFiles(tx, workspaceId, p);
  assert(
    workspace.revision === revision,
    412,
    'stale_revision',
    'The workspace has changed. Reload before saving.',
  );
  const object = await saveContent(p.organizationId, bytes);
  const next = files.filter((f) => f.path !== filePath);
  next.push({
    ...object,
    path: filePath,
    type: 'file',
    modified_at: new Date().toISOString(),
    git_ignored: filePath.split('/').some((x) => x.startsWith('.')),
  });
  const cp = await checkpoint(tx, p, workspaceId, 'File saved', next);
  const updated = await resources.update(tx, 'workspaces', workspaceId, checkpointState(cp), revision);
  return resources.operation(tx, p, 'file_write', {
    workspace_id: workspaceId,
    revision: updated.revision,
    checkpoint_id: cp.id,
  });
}
export async function deleteFile(
  tx: Tx,
  p: Principal,
  workspaceId: string,
  filePath: string,
  revision: string,
) {
  normalizePath(filePath);
  await ensureWritable(tx, workspaceId);
  const { workspace, files } = await workspaceFiles(tx, workspaceId, p);
  assert(workspace.revision === revision, 412, 'stale_revision', 'The workspace has changed.');
  assert(
    files.some((f) => f.path === filePath),
    404,
    'not_found',
    'File not found.',
  );
  const next = files.filter((f) => f.path !== filePath);
  const cp = await checkpoint(tx, p, workspaceId, 'File removed', next);
  const updated = await resources.update(tx, 'workspaces', workspaceId, checkpointState(cp), revision);
  return resources.operation(tx, p, 'file_delete', { workspace_id: workspaceId, revision: updated.revision });
}
export async function createWorkspace(
  tx: Tx,
  p: Principal,
  projectId: string,
  input: Record<string, unknown>,
) {
  // Serialize branch checks and first-workspace selection. The unique index remains the
  // backstop; callers receive a useful branch conflict instead of a SQL constraint error.
  await lock(tx, `project-workspaces:${projectId}`);
  const project = await resources.get(tx, 'projects', projectId, p);
  const source = input.source as { kind?: string; checkpoint_id?: string; ref?: string } | undefined;
  let files: FileRecord[] = [],
    gitFiles: FileRecord[] = [];
  const checkpointId = source?.checkpoint_id || input.checkpoint_id;
  if (checkpointId) {
    const cp = await resources.get(tx, 'checkpoints', String(checkpointId), p);
    assert(cp.project_id === projectId, 400, 'invalid_request', 'Checkpoint belongs to another project.');
    files = cp.files as FileRecord[];
    gitFiles = (cp.git_files || []) as FileRecord[];
  } else if (project.default_workspace_id) {
    const base = await workspaceFiles(tx, String(project.default_workspace_id), p);
    files = base.files;
    gitFiles = (base.workspace.git_files || []) as FileRecord[];
  }
  const branch = branchName(
    String(input.branch || input.name)
      .trim()
      .replace(/\s+/g, '-'),
  );
  if (source?.ref) {
    const selected = await withRepository(gitFiles, async (repo) => {
      await repo.select(branch, source.ref);
      return { files: await repo.files(p.organizationId), git: await repo.save(p.organizationId) };
    });
    files = selected.files;
    gitFiles = selected.git;
  }
  const collision = await tx.query("SELECT id FROM workspaces WHERE project_id=$1 AND data->>'branch'=$2", [
    projectId,
    branch,
  ]);
  assert(!collision.rowCount, 409, 'branch_exists', 'This workspace branch already exists.');
  const ws = await resources.create(tx, 'workspaces', p.organizationId, {
    project_id: projectId,
    name: input.name,
    branch,
    status: 'idle',
    deleted: false,
    files,
    git_files: gitFiles,
    source_ref: source?.ref || project.target_branch || 'main',
  });
  const cp = await checkpoint(tx, p, ws.id, 'Workspace created');
  await resources.update(tx, 'workspaces', ws.id, {
    ...checkpointState(cp),
    base_checkpoint_id: cp.id,
  });
  if (!project.default_workspace_id)
    await resources.update(tx, 'projects', projectId, { default_workspace_id: ws.id });
  return resources.operation(tx, p, 'workspace_create', { workspace_id: ws.id, project_id: projectId });
}

/** Publish the file and Git namespaces together; callers keep their existing workspace CAS/lease checks. */
export function checkpointState(cp: resources.Document) {
  return {
    files: cp.files,
    git_files: cp.git_files || [],
    git_commit: cp.git_commit,
    git_status: cp.git_status,
    git_error: cp.git_error || null,
    latest_checkpoint_id: cp.id,
    last_verified_at: new Date().toISOString(),
  };
}
