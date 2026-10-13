-- Only resource classification crosses the tenant boundary, never execution
-- bindings, prompts, provider identifiers or credentials.
CREATE OR REPLACE VIEW reporting.scheduling_runs WITH(security_barrier=true) AS
 SELECT r.id,r.organization_id,r.workspace_id,r.worktree_id,r.status,r.created_at,r.started_at,r.completed_at,
 r.queue_expires_at,r.cancel_requested,coalesce(r.config->>'scheduling_class','background') AS scheduling_class,
 (coalesce(p.data->>'archived','false')='true' OR coalesce(p.data->>'deleted','false')='true'
  OR coalesce(w.data->>'deleted','false')='true' OR w.data->>'status' IN ('deleting','degraded','restoring')) IS TRUE AS unavailable,
 r.kind,
 EXISTS(SELECT 1 FROM dispatch_jobs j WHERE j.kind='run' AND j.resource_id=r.id AND j.state='blocked') AS dispatch_blocked,
 CASE WHEN r.kind<>'native_agent' THEN 'inference'
   WHEN r.status='queued' OR r.execution_binding IS NULL OR r.execution_binding->>'phase'='provision' THEN 'provision'
   WHEN r.execution_binding->>'phase' IN ('input','hydrate','restore','index','upload','publish') THEN 'transfer'
   ELSE 'control' END AS dispatch_class
 FROM runs r LEFT JOIN worktrees w ON w.id=r.worktree_id LEFT JOIN workspaces p ON p.id=r.workspace_id;
ALTER VIEW reporting.scheduling_runs OWNER TO platform_reporting;
