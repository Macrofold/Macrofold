-- New submissions get a full disruption tolerance; existing deadlines are unchanged.
ALTER TABLE runs ALTER COLUMN queue_expires_at SET DEFAULT now()+interval '24 hours';
ALTER TABLE organizations
 ADD COLUMN run_concurrency_limit integer CHECK(run_concurrency_limit BETWEEN 1 AND 10000),
 ADD COLUMN run_timeout_seconds integer CHECK(run_timeout_seconds BETWEEN 1 AND 7200),
 ADD COLUMN scheduler_finish double precision NOT NULL DEFAULT 0;
CREATE TABLE scheduler_clock (id boolean PRIMARY KEY DEFAULT true CHECK(id), virtual_time double precision NOT NULL DEFAULT 0);
INSERT INTO scheduler_clock(id) VALUES(true);
ALTER TABLE billing_orders ADD COLUMN subscription_plan text CHECK(subscription_plan IN ('pro','scale'));

-- Only scheduling metadata crosses the tenant boundary. No prompt, file, result or credential.
CREATE VIEW reporting.scheduling_runs WITH(security_barrier=true) AS
 SELECT r.id,r.organization_id,r.project_id,r.workspace_id,r.status,r.created_at,r.started_at,r.completed_at,
 r.queue_expires_at,r.cancel_requested,coalesce(r.config->>'scheduling_class','background') AS scheduling_class,
 (coalesce(p.data->>'archived','false')='true' OR coalesce(p.data->>'deleted','false')='true'
  OR coalesce(w.data->>'deleted','false')='true' OR w.data->>'status' IN ('deleting','degraded','restoring')) IS TRUE AS unavailable
 FROM runs r JOIN workspaces w ON w.id=r.workspace_id JOIN projects p ON p.id=r.project_id;
GRANT SELECT ON workspaces,projects TO platform_reporting;
CREATE POLICY reporting_read ON workspaces FOR SELECT TO platform_reporting USING(true);
CREATE POLICY reporting_read ON projects FOR SELECT TO platform_reporting USING(true);
ALTER VIEW reporting.scheduling_runs OWNER TO platform_reporting;
