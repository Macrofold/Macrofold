import type { Tx } from '../../db';
import type { Principal } from './auth';
import type { components } from '../../contracts/api';
import { assert } from './errors';
import { validatePermissions } from './agent-permissions';
import { authorizeRepository } from './github-auth';
import { queueGitSync } from './git-jobs';
import { createWorkspace } from './files';
import * as resources from './resources';

/** Shared creation policy for the core API and optional integration paths. */
export async function createProject(tx: Tx, p: Principal, value: components['schemas']['ProjectCreate']) {
  assert(
    !p.projectIds.length,
    403,
    'forbidden',
    'A project-restricted key cannot create unrelated projects.',
  );
  validatePermissions(value.permissions);
  if (value.github) await authorizeRepository(tx, p, value.github);
  const project = await resources.create(tx, 'projects', p.organizationId, {
    ...value,
    persistence: value.persistence || 'persistent',
    archived: false,
    storage_bytes: '0',
  });
  await createWorkspace(tx, p, project.id, { name: 'main', branch: value.github?.target_branch || 'main' });
  const created = await resources.get(tx, 'projects', project.id, p);
  if (value.github) await queueGitSync(tx, p, String(created.default_workspace_id), 'pull');
  return created;
}
