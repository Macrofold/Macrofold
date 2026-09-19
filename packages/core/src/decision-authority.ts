import { lock, type Tx } from '../../db';
import { requireWorkspace, type Principal } from './auth';
import { assert } from './errors';
import * as resources from './resources';

export function requireApplication(
  p: Principal,
  workspaceId: string,
): asserts p is Principal & { userId: string } {
  requireWorkspace(p, workspaceId);
  assert(
    p.kind === 'api_key' && p.workspaceIds.length === 1 && p.workspaceIds[0] === workspaceId && p.userId,
    403,
    'workspace_application_required',
    'Use a backend API key restricted to exactly this workspace.',
  );
}

export async function requireDecisionWorkspace(tx: Tx, p: Principal, workspaceId: string) {
  requireWorkspace(p, workspaceId);
  await lock(tx, `workspace-deletion:${workspaceId}`);
  const workspace = await resources.get(tx, 'workspaces', workspaceId, p);
  assert(
    !workspace.archived && !workspace.deleted,
    409,
    'workspace_unavailable',
    'Restore the workspace before submitting work.',
  );
  return workspace;
}

/** Direct calls belong to the authenticated account; a workspace is optional. */
export function requireInferenceCaller(
  p: Principal,
  workspaceId?: string,
): asserts p is Principal & { userId: string } {
  assert(p.kind === 'api_key' && p.userId, 403, 'api_key_required', 'Use a backend API key.');
  requireWorkspace(p, workspaceId ?? null);
}
