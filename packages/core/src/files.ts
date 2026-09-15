import { validatePermissions } from './agent-permissions';
import { assert } from './errors';
import { workspaceIdentity, assertWorkspaceName, projectBranches } from './workspace-names';
import * as resources from './resources';
import { lock, type Tx } from '../../db';
import { storagePreparation } from './storage-preparation';
import { saveContent, verifyContent } from '../../providers/src/storage';
import type { Principal } from './auth';
import { gitRevision, withRepository } from '../../providers/src/git-repository';
import { requireStorageCapacity } from './storage-maintenance';
import type { components } from '../../contracts/api';
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
export function fileEntry(file: FileRecord, revision: string): components['schemas']['FileEntry'] {
  const { path, type, size_bytes, modified_at, git_ignored, sha256 } = file;
  return { path, type, size_bytes, modified_at, git_ignored, sha256, revision };
}
/** Directories are derived from durable files, including conventional .gitkeep markers. */
export function listFileEntries(
  files: FileRecord[],
  revision: string,
  prefix: string,
  recursive: boolean,
): components['schemas']['FileEntry'][] {
  if (recursive)
    return files
      .filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`))
      .map((file) => fileEntry(file, revision));
  const entries = new Map<string, components['schemas']['FileEntry']>();
  for (const file of files) {
    if (prefix && !file.path.startsWith(`${prefix}/`)) continue;
    const relative = prefix ? file.path.slice(prefix.length + 1) : file.path;
    const slash = relative.indexOf('/');
    const path = slash < 0 ? file.path : (prefix ? `${prefix}/` : '') + relative.slice(0, slash);
    entries.set(path, slash < 0 ? fileEntry(file, revision) : { path, type: 'directory', revision });
  }
  return [...entries.values()];
}
function assertPathAvailable(files: FileRecord[], path: string) {
  assert(
    !files.some((file) => file.path === path || file.path.startsWith(`${path}/`)),
    409,
    'file_path_conflict',
    'A file or folder already exists at this path. Choose another name.',
  );
  assertFileTree([...files, { path }]);
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
  const data = await prepareCheckpoint(
    p.organizationId,
    workspace,
    filesOverride || files,
    label,
    gitOverride,
  );
  return saveCheckpoint(tx, p, data);
}

/** Prepares immutable bytes with no database connection. A caller outside a
 * transaction must hold a storagePreparation until publication finishes. */
export async function prepareCheckpoint(
  org: string,
  workspace: resources.Document<'workspaces'>,
  files: FileRecord[],
  label: string,
  gitOverride?: FileRecord[],
  baseline: FileRecord[] = [],
) {
  const next = files;
  assertFileTree(next);
  const trusted = new Set(baseline.map((file) => `${file.key}:${file.sha256}`));
  for (const file of next)
    if (!trusted.has(`${file.key}:${file.sha256}`)) await verifyContent(file.key, file.sha256);
  let gitState: import('./resource-models').GitState;
  try {
    gitState = await gitRevision(
      org,
      String(workspace.branch || 'main'),
      next,
      gitOverride || ((workspace.git_files || []) as FileRecord[]),
      label,
      workspace.git_status === 'ready' ? baseline : [],
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
  return {
    workspace_id: workspace.id,
    project_id: workspace.project_id,
    label,
    ...gitState,
    consistency: 'quiescent' as const,
    verification: 'verified' as const,
    pinned: false,
    size_bytes: String(
      [...next, ...(gitState.git_files as FileRecord[])].reduce((n, f) => n + Number(f.size_bytes), 0),
    ),
  };
}

async function saveCheckpoint(tx: Tx, p: Principal, data: Awaited<ReturnType<typeof prepareCheckpoint>>) {
  const snapshot = await resources.create(tx, 'checkpoints', p.organizationId, { ...data, created_by: p.id });
  await tx.query('UPDATE organizations SET storage_due_at=least(storage_due_at,now()) WHERE id=$1', [
    p.organizationId,
  ]);
  return snapshot;
}
export type FileMutation =
  | { kind: 'file_write'; path: string; bytes: Buffer; createOnly: boolean }
  | { kind: 'folder_create'; path: string }
  | { kind: 'file_delete'; path: string }
  | { kind: 'file_rename' | 'file_duplicate'; path: string; newPath: string };
const mutationLabels = {
  file_write: 'File saved',
  folder_create: 'Folder created',
  file_delete: 'File removed',
  file_rename: 'File renamed',
  file_duplicate: 'File duplicated',
};

/** Read/prepare/commit: object and Git I/O happens outside SQL transactions. The
 * commit rechecks writer exclusion, authority, capacity and the exact source revision. */
export async function prepareFileMutation(
  p: Principal,
  workspaceId: string,
  revision: string,
  mutation: FileMutation,
) {
  normalizePath(mutation.path);
  if ('newPath' in mutation) normalizePath(mutation.newPath);
  if (mutation.kind === 'file_write')
    assert(
      mutation.bytes.length <= 4 * 1024 * 1024,
      413,
      'file_too_large',
      'Use a staged transfer for files larger than 4 MiB.',
    );
  const addsBytes = ['file_write', 'folder_create', 'file_duplicate'].includes(mutation.kind);
  const preparation = await storagePreparation(p.organizationId, async (tx) => {
    await ensureWritable(tx, workspaceId);
    const source = await workspaceFiles(tx, workspaceId, p);
    assert(
      source.workspace.revision === revision,
      412,
      'stale_revision',
      'The worktree has changed. Reload before saving.',
    );
    if (addsBytes) await requireStorageCapacity(tx, p.organizationId);
    return source;
  });
  try {
    const { workspace, files } = preparation.value;
    const original = files.find((file) => file.path === mutation.path);
    const now = new Date().toISOString();
    let path = mutation.path;
    let next: FileRecord[];
    switch (mutation.kind) {
      case 'file_write': {
        if (mutation.createOnly) assertPathAvailable(files, path);
        else assertFileTree([...files.filter((file) => file.path !== path), { path }]);
        const object = await saveContent(p.organizationId, mutation.bytes);
        next = [
          ...files.filter((file) => file.path !== path),
          {
            ...object,
            path,
            type: 'file',
            mode: original?.type === 'file' ? original.mode : undefined,
            modified_at: now,
            git_ignored: false,
          },
        ];
        break;
      }
      case 'folder_create': {
        assertPathAvailable(files, path);
        const object = await saveContent(p.organizationId, Buffer.alloc(0));
        next = [
          ...files,
          {
            ...object,
            path: normalizePath(`${path}/.gitkeep`),
            type: 'file',
            modified_at: now,
            git_ignored: false,
          },
        ];
        break;
      }
      case 'file_delete':
        assert(original, 404, 'not_found', 'File not found.');
        next = files.filter((file) => file !== original);
        break;
      case 'file_rename':
      case 'file_duplicate':
        assert(original, 404, 'not_found', 'File not found.');
        assertPathAvailable(files, mutation.newPath);
        // Verify the reused object before publishing a new path to it.
        await verifyContent(original.key, original.sha256);
        path = mutation.newPath;
        next = [
          ...files.filter((file) => mutation.kind === 'file_duplicate' || file !== original),
          { ...original, path, modified_at: now },
        ];
        break;
    }
    // Existing verified content is already durable. New/replaced objects are verified;
    // unchanged blobs keep their verified checkpoint provenance rather than being re-read.
    const baseline = workspace.latest_checkpoint_id ? files : [];
    const data = await prepareCheckpoint(
      p.organizationId,
      workspace,
      next,
      mutationLabels[mutation.kind],
      undefined,
      baseline,
    );
    return {
      dispose: preparation.dispose,
      async commit(tx: Tx, current: Principal) {
        await preparation.assertActive(tx);
        await ensureWritable(tx, workspaceId);
        const source = await workspaceFiles(tx, workspaceId, current);
        assert(
          source.workspace.revision === revision,
          412,
          'stale_revision',
          'The worktree changed while preparing this edit. Reload and retry.',
        );
        if (addsBytes) await requireStorageCapacity(tx, current.organizationId);
        const cp = await saveCheckpoint(tx, current, data);
        const updated = await resources.update(tx, 'workspaces', workspaceId, checkpointState(cp), revision);
        const record = (cp.files as FileRecord[]).find((file) => file.path === path);
        const entry =
          mutation.kind === 'folder_create'
            ? { path, type: 'directory' as const, revision: updated.revision }
            : record && fileEntry(record, updated.revision);
        return resources.operation(tx, current, mutation.kind, {
          workspace_id: workspaceId,
          checkpoint_id: cp.id,
          revision: updated.revision,
          path,
          ...(mutation.kind === 'file_rename' ? { previous_path: mutation.path } : {}),
          ...(entry ? { entry } : {}),
        });
      },
    };
  } catch (error) {
    await preparation.dispose();
    throw error;
  }
}

export async function createWorkspace(
  tx: Tx,
  p: Principal,
  projectId: string,
  input: components['schemas']['WorkspaceCreate'],
) {
  validatePermissions(input.permissions);
  // Serialize name checks and first-worktree selection; the unique index is a backstop.
  await lock(tx, `project-workspaces:${projectId}`);
  const project = await resources.get(tx, 'projects', projectId, p);
  const source = input.source as { kind?: string; checkpoint_id?: string; ref?: string } | undefined;
  let files: FileRecord[] = [],
    gitFiles: FileRecord[] = [];
  const checkpointId = source?.checkpoint_id;
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
  const identity = workspaceIdentity(input.name as string | undefined, input.branch as string | undefined);
  const { name, branch } = identity;
  await assertWorkspaceName(tx, projectId, name);
  const existing = branch
    ? (await projectBranches(tx, p, projectId)).find((item) => item.name === branch)
    : undefined;
  const explicitBranch = typeof input.branch === 'string' && Boolean(input.branch.trim());
  const createsBranch = input.branch_mode === 'new' || (!explicitBranch && Boolean(name));
  assert(
    !createsBranch || !existing,
    409,
    'branch_exists',
    'This branch already exists. Select Use existing branch or choose another name.',
  );
  assert(
    input.branch_mode !== 'existing' || existing,
    404,
    'git_ref_not_found',
    'Choose an existing branch.',
  );
  // An explicitly selected existing branch uses its saved tree, not the current branch's files.
  const ref = source?.ref || (existing && input.branch ? existing.ref : undefined);
  if (ref && branch) {
    if (existing && !source?.ref) {
      const origin = await workspaceFiles(tx, existing.workspace_id, p);
      gitFiles = (origin.workspace.git_files || []) as FileRecord[];
    }
    const selected = await withRepository(gitFiles, async (repo) => {
      await repo.select(branch, ref);
      return { files: await repo.files(p.organizationId), git: await repo.save(p.organizationId) };
    });
    files = selected.files;
    gitFiles = selected.git;
  }
  const ws = await resources.create(tx, 'workspaces', p.organizationId, {
    project_id: projectId,
    name,
    branch,
    status: 'idle',
    deleted: false,
    files,
    git_files: gitFiles,
    source_ref: source?.ref || project.target_branch || 'main',
    permissions: input.permissions,
  });
  const cp = await checkpoint(tx, p, ws.id, 'Workspace created');
  assert(cp.git_status !== 'attention', 409, 'git_branch_failed', 'Unable to prepare the worktree branch.');
  await resources.update(tx, 'workspaces', ws.id, {
    ...checkpointState(cp),
    base_checkpoint_id: cp.id,
  });
  if (!project.default_workspace_id)
    await resources.update(tx, 'projects', projectId, { default_workspace_id: ws.id });
  return resources.operation(tx, p, 'workspace_create', { workspace_id: ws.id, project_id: projectId });
}

/** Assign deferred metadata once, inside admission's transaction and project lock.
 * A readable prompt-derived slug requires no additional model call or spending. */
export async function nameWorkspaceForRun(tx: Tx, p: Principal, workspaceId: string, prompt: string) {
  const original = await resources.get(tx, 'workspaces', workspaceId, p);
  await lock(tx, `project-workspaces:${original.project_id}`);
  const workspace = await resources.get(tx, 'workspaces', workspaceId, p);
  if (workspace.name && workspace.branch) return workspace;
  const stem =
    prompt
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 52)
      .replace(/-$/g, '') || 'agent-task';
  const rows = await tx.query(
    "SELECT data->>'name' AS name,data->>'branch' AS branch FROM workspaces WHERE project_id=$1 AND COALESCE(data->>'deleted','false')='false'",
    [workspace.project_id],
  );
  const occupied = new Set(
    rows.rows.flatMap((row) => [
      String(row.name ?? '').toLowerCase(),
      String(row.branch ?? '').toLowerCase(),
    ]),
  );
  for (const ref of await projectBranches(tx, p, String(workspace.project_id)))
    occupied.add(ref.name.toLowerCase());
  let generated = stem;
  for (let suffix = 2; occupied.has(generated); suffix++) generated = `${stem}-${suffix}`;
  const identity = workspaceIdentity(
    typeof workspace.name === 'string' ? workspace.name : generated,
    typeof workspace.branch === 'string' ? workspace.branch : undefined,
  );
  await assertWorkspaceName(tx, String(workspace.project_id), identity.name, workspaceId);
  await resources.update(tx, 'workspaces', workspaceId, identity);
  const cp = await checkpoint(tx, p, workspaceId, 'Worktree named');
  assert(
    cp.git_status !== 'attention',
    409,
    'git_branch_failed',
    'Unable to prepare the worktree branch. Files remain unchanged.',
  );
  return resources.update(tx, 'workspaces', workspaceId, checkpointState(cp));
}

/** Publish the file and Git namespaces together; callers keep their existing workspace CAS/lease checks. */
export function checkpointState(cp: resources.Document<'checkpoints'>) {
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
