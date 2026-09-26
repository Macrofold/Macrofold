-- Retire worktree-owned compute only after the previous deployment has drained it.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM sandboxes WHERE status<>'destroyed' OR active_run_id IS NOT NULL OR reserved_micro_usd<>0)
 OR EXISTS(SELECT 1 FROM runs WHERE config ? 'sandbox_id' AND status NOT IN ('succeeded','failed','cancelled','timed_out')) THEN
  RAISE EXCEPTION 'Drain and destroy previous compute allocations before applying Worker cutover; files and sessions remain durable.';
 END IF;
END $$;

-- Financial journals stay append-only. This small archive contains no credentials,
-- provider binding, executable policy, or resumable compute state.
CREATE TABLE compute_history (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 reference_kind text NOT NULL,
 provider text NOT NULL,
 name text,
 created_at timestamptz NOT NULL,
 retired_at timestamptz NOT NULL,
 UNIQUE(organization_id,id)
);
INSERT INTO compute_history(id,organization_id,reference_kind,provider,name,created_at,retired_at)
 SELECT id,organization_id,'sandbox',provider,name,created_at,updated_at FROM sandboxes;
ALTER TABLE compute_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE compute_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON compute_history USING(organization_id::text=current_setting('app.organization_id',true));
CREATE POLICY reporting_read ON compute_history FOR SELECT TO platform_reporting USING(true);
GRANT SELECT ON compute_history TO platform_reporting;
CREATE INDEX compute_history_tenant ON compute_history(organization_id,id);
DROP VIEW reporting.sandbox_schedule;
DROP TABLE sandboxes;

CREATE INDEX hosts_worker_history ON hosts(organization_id,worker_id,id);
CREATE INDEX runs_worker_history ON runs(organization_id,(config->>'worker_id'),id DESC) WHERE config ? 'worker_id';
-- Dormant targets need no polling. Admission/resume wakes a target through existing
-- queue records; live allocations continue reconciliation even after destruction.
CREATE OR REPLACE VIEW reporting.worker_schedule WITH(security_barrier=true) AS
 SELECT w.id,w.organization_id,w.next_check_at FROM workers w
 WHERE EXISTS(SELECT 1 FROM hosts h WHERE h.worker_id=w.id AND h.status<>'stopped')
 OR (w.desired_state='enabled' AND (w.expires_at IS NULL OR w.expires_at>now()) AND
   ((w.settings->>'min_instances')::integer>0 OR EXISTS(
     SELECT 1 FROM runs r WHERE r.organization_id=w.organization_id AND r.config->>'worker_id'=w.id::text
       AND r.status='queued' AND NOT r.cancel_requested AND r.queue_expires_at>now())));
ALTER VIEW reporting.worker_schedule OWNER TO platform_reporting;
