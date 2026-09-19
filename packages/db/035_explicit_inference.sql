-- Apply with lightweight admission disabled. Existing native rows retain their identity.
ALTER TABLE runs ADD COLUMN kind text NOT NULL DEFAULT 'native_agent'
 CHECK(kind IN ('native_agent','inference','bounded_agent'));
ALTER TABLE runs ALTER COLUMN workspace_id DROP NOT NULL, ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE runs ADD CONSTRAINT run_project_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id);
ALTER TABLE runs ADD CONSTRAINT run_kind_shape CHECK (
 (kind='native_agent' AND workspace_id IS NOT NULL AND session_id IS NOT NULL AND config ? 'harness') OR
 (kind IN ('inference','bounded_agent') AND workspace_id IS NULL AND session_id IS NULL AND NOT config ? 'harness'
  AND config->>'executor_version'='1' AND config ? 'definition' AND config ? 'context')
);
-- Invocation evidence lives beside the existing gateway financial identity, not in a new ledger.
CREATE TABLE decision_invocations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid NOT NULL,
 step integer NOT NULL CHECK(step>=0), state text NOT NULL CHECK(state IN ('prepared','dispatch_started','responded','uncertain')),
 provider_request_digest text NOT NULL, body_ciphertext text NOT NULL, response_ciphertext text,
 created_at timestamptz NOT NULL DEFAULT now(), dispatch_started_at timestamptz, responded_at timestamptz,
 UNIQUE(run_id,step), FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id),
 FOREIGN KEY(id) REFERENCES gateway_requests(id)
);
ALTER TABLE decision_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_invocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON decision_invocations USING(organization_id::text=current_setting('app.organization_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
CREATE OR REPLACE VIEW reporting.scheduling_runs WITH(security_barrier=true) AS
 SELECT r.id,r.organization_id,r.project_id,r.workspace_id,r.status,r.created_at,r.started_at,r.completed_at,
 r.queue_expires_at,r.cancel_requested,coalesce(r.config->>'scheduling_class','background') AS scheduling_class,
 (coalesce(p.data->>'archived','false')='true' OR coalesce(p.data->>'deleted','false')='true'
  OR coalesce(w.data->>'deleted','false')='true' OR w.data->>'status' IN ('deleting','degraded','restoring')) IS TRUE AS unavailable,
 r.kind
 FROM runs r LEFT JOIN workspaces w ON w.id=r.workspace_id JOIN projects p ON p.id=r.project_id;
ALTER VIEW reporting.scheduling_runs OWNER TO platform_reporting;
