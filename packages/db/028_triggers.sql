-- Inbound routing contains identifiers only. Credentials, prompts and deliveries remain tenant protected.
CREATE TABLE trigger_routes (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 kind text NOT NULL CHECK(kind IN ('slack','webhook'))
);
CREATE TABLE slack_connections (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 owner_user_id text NOT NULL REFERENCES auth."user"(id), name text NOT NULL,
 team_id text NOT NULL, bot_user_id text NOT NULL, secret_ciphertext text NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,id)
);
CREATE TABLE triggers (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 project_id uuid NOT NULL, agent_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('slack','webhook','schedule')),
 name text NOT NULL, prompt text NOT NULL, enabled boolean NOT NULL DEFAULT true,
 actor jsonb NOT NULL, settings jsonb NOT NULL DEFAULT '{}', secret_hash text,
 slack_connection_id uuid, channel_id text, next_fire_at timestamptz,
 max_runs_per_day integer NOT NULL DEFAULT 100 CHECK(max_runs_per_day BETWEEN 1 AND 1000),
 revision integer NOT NULL DEFAULT 1, last_error_code text, last_fired_at timestamptz,
 deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id),
 FOREIGN KEY(organization_id,agent_id) REFERENCES agents(organization_id,id),
 FOREIGN KEY(organization_id,slack_connection_id) REFERENCES slack_connections(organization_id,id)
);
CREATE UNIQUE INDEX one_slack_channel_trigger ON triggers(slack_connection_id,channel_id) WHERE kind='slack' AND deleted_at IS NULL;
CREATE INDEX scheduled_triggers_due ON triggers(organization_id,next_fire_at) WHERE kind='schedule' AND enabled AND deleted_at IS NULL;
CREATE TABLE trigger_deliveries (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), trigger_id uuid NOT NULL,
 external_id text NOT NULL, request_hash text NOT NULL, prompt_ciphertext text NOT NULL, trigger_revision integer NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','failed','skipped')),
 run_id uuid, error_code text, received_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 reply_connection_id uuid, reply_channel text, reply_thread text,
 reply_state text NOT NULL DEFAULT 'none' CHECK(reply_state IN ('none','pending','sending','sent','failed','uncertain')),
 reply_ts text, UNIQUE(trigger_id,external_id), UNIQUE(run_id),
 FOREIGN KEY(organization_id,trigger_id) REFERENCES triggers(organization_id,id),
 FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id),
 FOREIGN KEY(organization_id,reply_connection_id) REFERENCES slack_connections(organization_id,id)
);
CREATE INDEX trigger_delivery_history ON trigger_deliveries(trigger_id,id DESC);
CREATE INDEX trigger_delivery_pending ON trigger_deliveries(trigger_id,received_at) WHERE status='pending';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['slack_connections','triggers','trigger_deliveries'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id::text = current_setting(''app.organization_id'',true)) WITH CHECK (organization_id::text = current_setting(''app.organization_id'',true))', t);
 END LOOP;
END $$;
