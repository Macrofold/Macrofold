import type { Tx } from '../../db';
import type { Principal } from './auth';
import type { components } from '../../contracts/api';
import { assert } from './errors';
import { validatePermissions } from './agent-permissions';
import { authorizeRepository } from './github-auth';
import { queueGitSync } from './git-jobs';
import { createWorktree } from './files';
import * as resources from './resources';

/** Shared creation policy for the core API and optional integration paths. */
export async function createWorkspace(tx: Tx, p: Principal, value: components['schemas']['WorkspaceCreate']) {
  assert(
    !p.workspaceIds.length,
    403,
    'forbidden',
    'A workspace-restricted key cannot create unrelated workspaces.',
  );
  validatePermissions(value.permissions);
  if (value.github) await authorizeRepository(tx, p, value.github);
  const workspace = await resources.create(tx, 'workspaces', p.organizationId, {
    ...value,
    persistence: value.persistence || 'persistent',
    archived: false,
    storage_bytes: '0',
  });
  await createWorktree(tx, p, workspace.id, { name: 'main', branch: value.github?.target_branch || 'main' });
  const created = await resources.get(tx, 'workspaces', workspace.id, p);
  if (value.github) await queueGitSync(tx, p, String(created.default_worktree_id), 'pull');
  return created;
}
