-- Optional capabilities are bound to an authorized Worktree, never a global
-- preset or caller-supplied customer label. Collection IDs remain server-owned.
CREATE TABLE agent_integrations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 workspace_id uuid NOT NULL,
 worktree_id uuid NOT NULL,
 pack_id text NOT NULL CHECK (pack_id IN ('file-memory','hindsight','claude-mem')),
 state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused','disabled')),
 generation bigint NOT NULL DEFAULT 1,
 revision bigint NOT NULL DEFAULT 1,
 configuration jsonb NOT NULL DEFAULT '{}',
 owner_user_id text,
 service_identity text,
 removed_at timestamptz,
 retired_at timestamptz,
 last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id),
 FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,worktree_id) REFERENCES worktrees(organization_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agent_integrations_worktree ON agent_integrations(organization_id,worktree_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX agent_integrations_service_identity ON agent_integrations(service_identity) WHERE service_identity IS NOT NULL;
CREATE INDEX agent_integrations_listing ON agent_integrations(organization_id,id DESC);
CREATE INDEX agent_integrations_workspace ON agent_integrations(organization_id,workspace_id,id);
ALTER TABLE agent_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_integrations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_integrations
 USING (organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK (organization_id::text=current_setting('app.organization_id',true));

-- Source references are durable capture cursors, not another execution queue.
-- The existing dispatch_jobs/maintenance owner schedules and leases the work.
CREATE TABLE integration_sources (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 integration_id uuid NOT NULL,
 source_run_id uuid,
 generation bigint NOT NULL,
 kind text NOT NULL DEFAULT 'capture' CHECK (kind IN ('capture','purge')),
 state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sending','waiting','complete','failed','unknown','cancelled')),
 text_ciphertext text,
 text_bytes bigint,
 forgotten_at timestamptz,
 receipt jsonb,
 error_code text,
 lease_token uuid,
 failures integer NOT NULL DEFAULT 0,
 polls integer NOT NULL DEFAULT 0,
 check_started_at timestamptz NOT NULL DEFAULT now(),
 trace_context jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(integration_id,source_run_id,generation),
 FOREIGN KEY (organization_id,integration_id) REFERENCES agent_integrations(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,source_run_id) REFERENCES runs(organization_id,id)
);
CREATE INDEX integration_sources_collection ON integration_sources(integration_id,id DESC);
ALTER TABLE integration_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_sources
 USING (organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK (organization_id::text=current_setting('app.organization_id',true));

CREATE TABLE integration_retrievals (
 organization_id uuid NOT NULL,
 run_id uuid NOT NULL,
 integration_id uuid NOT NULL,
 generation bigint NOT NULL,
 state text NOT NULL CHECK (state IN ('querying','ready','unavailable')),
 context_ciphertext text,
 error_code text,
 receipt jsonb,
 duration_ms integer,
 PRIMARY KEY(run_id,integration_id,generation),
 FOREIGN KEY (organization_id,run_id) REFERENCES runs(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,integration_id) REFERENCES agent_integrations(organization_id,id) ON DELETE CASCADE
);
ALTER TABLE integration_retrievals ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_retrievals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON integration_retrievals
 USING (organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK (organization_id::text=current_setting('app.organization_id',true));

CREATE INDEX dispatch_integration_due ON dispatch_jobs(available_at,id) WHERE kind='integration' AND state IN ('pending','running');
CREATE INDEX integration_unsettled_sources ON integration_sources(integration_id) WHERE state IN ('sending','waiting','unknown');
CREATE INDEX integration_tool_outcomes ON run_events(run_id,sequence DESC) WHERE type IN ('tool.started','tool.completed');

-- Control changes revoke only this memory owner's private search receipts.
CREATE INDEX operation_memory_search_owner ON operations(organization_id,(data->>'memory_integration_id')) WHERE data->>'kind'='memory_search';
