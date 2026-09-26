-- Compute policy is tenant-owned; physical generations and run assignments are independent.
CREATE TABLE workers (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 name text CHECK(name IS NULL OR length(name) BETWEEN 1 AND 100),
 settings jsonb NOT NULL CHECK(jsonb_typeof(settings)='object'),
 offerings jsonb NOT NULL CHECK(jsonb_typeof(offerings)='array'),
 desired_state text NOT NULL DEFAULT 'enabled' CHECK(desired_state IN ('enabled','paused','destroyed')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 expires_at timestamptz,
 next_check_at timestamptz NOT NULL DEFAULT now(),
 failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX worker_names ON workers(organization_id,lower(name)) WHERE name IS NOT NULL AND desired_state<>'destroyed';
CREATE INDEX workers_due ON workers(next_check_at) WHERE desired_state<>'destroyed';

-- An immutable quote is copied onto every allocation. Serving processes cannot edit the catalog.
CREATE TABLE worker_offerings (
 id text NOT NULL,
 revision uuid NOT NULL,
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(id,revision)
);

CREATE TABLE hosts (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 worker_id uuid NOT NULL,
 generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
 status text NOT NULL DEFAULT 'provisioning' CHECK(status IN ('provisioning','ready','draining','stopped')),
 provider text NOT NULL CHECK(provider IN ('simulator','docker','vercel','render')),
 provider_name text NOT NULL UNIQUE,
 binding jsonb,
 secret_ciphertext text NOT NULL,
 offering jsonb NOT NULL CHECK(jsonb_typeof(offering)='object'),
 capacity integer NOT NULL CHECK(capacity>0),
 memory_mib integer NOT NULL CHECK(memory_mib>0),
 cpu_millis integer NOT NULL CHECK(cpu_millis>0),
 reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK(reserved_micro_usd>=0),
 charged_micro_usd bigint NOT NULL DEFAULT 0 CHECK(charged_micro_usd>=0),
 billing_cursor jsonb,
 billing_sequence bigint NOT NULL DEFAULT 0 CHECK(billing_sequence>=0),
 funded_until timestamptz NOT NULL,
 started_at timestamptz,
 stopped_at timestamptz,
 expires_at timestamptz,
 idle_since timestamptz,
 last_observed_at timestamptz,
 lease_id uuid,
 lease_until timestamptz,
 next_check_at timestamptz NOT NULL DEFAULT now(),
 failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 UNIQUE(organization_id,worker_id,id),
 FOREIGN KEY(organization_id,worker_id) REFERENCES workers(organization_id,id),
 CHECK(status<>'stopped' OR stopped_at IS NOT NULL)
);
CREATE INDEX hosts_worker_live ON hosts(organization_id,worker_id,status) WHERE status<>'stopped';
CREATE INDEX hosts_due ON hosts(next_check_at) WHERE status<>'stopped';

-- Released assignments remain history. Cleanup, not public Run completion, relinquishes capacity.
CREATE TABLE host_runs (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 worker_id uuid NOT NULL,
 host_id uuid NOT NULL,
 host_generation integer NOT NULL CHECK(host_generation>0),
 run_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt>0),
 worktree_id uuid,
 session_id uuid,
 memory_mib integer NOT NULL CHECK(memory_mib>0),
 cpu_millis integer NOT NULL CHECK(cpu_millis>0),
 state text NOT NULL DEFAULT 'claimed' CHECK(state IN ('claimed','prepared','running','capturing','releasing','quarantined','released')),
 configuration jsonb NOT NULL DEFAULT '{}',
 claimed_at timestamptz NOT NULL DEFAULT now(),
 launched_at timestamptz,
 released_at timestamptz,
 UNIQUE(organization_id,id),
 UNIQUE(run_id,attempt),
 FOREIGN KEY(organization_id,worker_id,host_id) REFERENCES hosts(organization_id,worker_id,id),
 FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id),
 FOREIGN KEY(organization_id,worktree_id) REFERENCES worktrees(organization_id,id),
 FOREIGN KEY(organization_id,session_id) REFERENCES sessions(organization_id,id),
 CHECK((state='released')=(released_at IS NOT NULL))
);
CREATE UNIQUE INDEX host_run_live ON host_runs(run_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX host_run_writer ON host_runs(worktree_id) WHERE released_at IS NULL AND worktree_id IS NOT NULL;
CREATE UNIQUE INDEX host_run_session ON host_runs(session_id) WHERE released_at IS NULL AND session_id IS NOT NULL;
CREATE INDEX host_run_capacity ON host_runs(host_id) WHERE released_at IS NULL;
CREATE INDEX host_run_worker_capacity ON host_runs(worker_id) WHERE released_at IS NULL;

-- Local residency is advisory and never replaces the writer or publication fences.
CREATE TABLE host_materializations (
 organization_id uuid NOT NULL,
 host_id uuid NOT NULL,
 host_generation integer NOT NULL,
 worktree_id uuid NOT NULL,
 permission_view text NOT NULL,
 checkpoint_id uuid,
 state text NOT NULL CHECK(state IN ('clean','active','recovery_required')),
 last_used_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(host_id,host_generation,worktree_id,permission_view),
 FOREIGN KEY(organization_id,host_id) REFERENCES hosts(organization_id,id),
 FOREIGN KEY(organization_id,worktree_id) REFERENCES worktrees(organization_id,id)
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workers','hosts','host_runs','host_materializations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(organization_id::text=current_setting(''app.organization_id'',true)) WITH CHECK(organization_id::text=current_setting(''app.organization_id'',true))',t);
  EXECUTE format('GRANT SELECT ON %I TO platform_reporting',t);
  EXECUTE format('CREATE POLICY reporting_read ON %I FOR SELECT TO platform_reporting USING(true)',t);
 END LOOP;
END $$;
CREATE VIEW reporting.worker_schedule WITH(security_barrier=true) AS
 SELECT w.id,w.organization_id,w.next_check_at FROM workers w
 WHERE w.desired_state<>'destroyed' OR EXISTS(SELECT 1 FROM hosts h WHERE h.worker_id=w.id AND h.status<>'stopped');
ALTER VIEW reporting.worker_schedule OWNER TO platform_reporting;
CREATE VIEW reporting.worker_capacity WITH(security_barrier=true) AS
 SELECT w.id,w.organization_id,w.desired_state,w.expires_at,
 (w.settings->>'max_concurrency')::integer AS concurrency_limit,
 (SELECT count(*)::integer FROM host_runs a WHERE a.worker_id=w.id AND a.released_at IS NULL) AS occupied_slots,
 w.failure_code FROM workers w;
ALTER VIEW reporting.worker_capacity OWNER TO platform_reporting;
CREATE VIEW reporting.host_writers WITH(security_barrier=true) AS
 SELECT run_id,worktree_id,session_id FROM host_runs WHERE released_at IS NULL;
ALTER VIEW reporting.host_writers OWNER TO platform_reporting;
