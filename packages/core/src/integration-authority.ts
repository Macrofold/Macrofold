import type { Tx } from '../../db';

/** Current resource and optional installation-owner authority, without loading
 * the Worktree file inventory. Soft deletion never relies on FK cascades. */
export async function integrationResourceAvailable(
  tx: Tx,
  workspaceId: string,
  worktreeId: string,
  owner?: string | null,
) {
  const result = await tx.query(
    `SELECT 1 FROM worktrees t JOIN workspaces w ON w.id=t.workspace_id AND w.organization_id=t.organization_id
    WHERE t.id=$1 AND w.id=$2 AND coalesce(t.data->>'deleted','false')<>'true'
      AND coalesce(w.data->>'deleted','false')<>'true' AND coalesce(t.data->>'status','')<>'deleting'
      AND w.data->>'deletion_due_at' IS NULL
      AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=w.organization_id AND m.user_id=$3 AND m.role<>'viewer'))`,
    [worktreeId, workspaceId, owner || null],
  );
  return !!result.rowCount;
}
