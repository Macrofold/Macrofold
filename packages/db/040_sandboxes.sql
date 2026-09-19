-- Disposable compute is independent of durable worktree/checkpoint identity.
CREATE TABLE sandboxes (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 name text, provider text NOT NULL CHECK(provider IN ('docker','vercel','render')),
 long_running boolean NOT NULL, keep_warm_seconds integer CHECK(keep_warm_seconds BETWEEN 0 AND 86400),
 status text NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','ready','pausing','paused','destroying','destroyed','error')),
 generation integer NOT NULL DEFAULT 1, binding jsonb, secret_ciphertext text NOT NULL,
 active_run_id uuid, idle_expires_at timestamptz, expires_at timestamptz, started_at timestamptz, provisioning_at timestamptz NOT NULL DEFAULT now(),
 budget_micro_usd bigint NOT NULL CHECK(budget_micro_usd>0), reserved_micro_usd bigint NOT NULL DEFAULT 0,
 cost_micro_usd bigint NOT NULL DEFAULT 0, rate_micro_usd_per_minute bigint NOT NULL CHECK(rate_micro_usd_per_minute>=0),
 lease_id uuid, lease_until timestamptz, next_check_at timestamptz NOT NULL DEFAULT now(), failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), FOREIGN KEY(organization_id,workspace_id) REFERENCES workspaces(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 FOREIGN KEY(organization_id,active_run_id) REFERENCES runs(organization_id,id)
);
CREATE UNIQUE INDEX sandbox_names ON sandboxes(organization_id,lower(name)) WHERE name IS NOT NULL AND status<>'destroyed';
CREATE INDEX sandbox_due ON sandboxes(next_check_at) WHERE status<>'destroyed';
ALTER TABLE sandboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandboxes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sandboxes USING(organization_id::text=current_setting('app.organization_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
CREATE VIEW reporting.sandbox_schedule WITH(security_barrier=true) AS SELECT id,organization_id,next_check_at FROM sandboxes WHERE status NOT IN ('destroyed','paused') AND (active_run_id IS NULL OR status='creating');
GRANT SELECT ON sandboxes TO platform_reporting;
CREATE POLICY reporting_read ON sandboxes FOR SELECT TO platform_reporting USING(true);
ALTER VIEW reporting.sandbox_schedule OWNER TO platform_reporting;
