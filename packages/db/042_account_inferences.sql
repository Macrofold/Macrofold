-- Direct inference belongs to an account, without requiring a file workspace.
ALTER TABLE runs ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE runs ADD CONSTRAINT native_run_workspace_required
 CHECK (kind <> 'native_agent' OR workspace_id IS NOT NULL);
CREATE OR REPLACE VIEW reporting.scheduling_runs WITH(security_barrier=true) AS
 SELECT r.id,r.organization_id,r.workspace_id,r.worktree_id,r.status,r.created_at,r.started_at,r.completed_at,
 r.queue_expires_at,r.cancel_requested,coalesce(r.config->>'scheduling_class','background') AS scheduling_class,
 (coalesce(p.data->>'archived','false')='true' OR coalesce(p.data->>'deleted','false')='true'
  OR coalesce(w.data->>'deleted','false')='true' OR w.data->>'status' IN ('deleting','degraded','restoring')) IS TRUE AS unavailable,
 r.kind
 FROM runs r LEFT JOIN worktrees w ON w.id=r.worktree_id LEFT JOIN workspaces p ON p.id=r.workspace_id;
ALTER VIEW reporting.scheduling_runs OWNER TO platform_reporting;
