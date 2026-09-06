CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth."user" (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL DEFAULT false,
 image text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth.session (
 id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(), "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS auth.account (
 id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE,
 "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
 scope text, password text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth.verification (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), plan text NOT NULL DEFAULT 'payg', balance_micro_usd bigint NOT NULL DEFAULT 0, reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0), settings jsonb NOT NULL DEFAULT '{}');
CREATE TABLE memberships (organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE, user_id text REFERENCES auth."user"(id) ON DELETE CASCADE, role text NOT NULL CHECK(role IN ('owner','admin','member','viewer')), PRIMARY KEY(organization_id,user_id));
CREATE TABLE api_keys (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), user_id text NOT NULL REFERENCES auth."user"(id), name text NOT NULL, key_hash text NOT NULL UNIQUE, prefix text NOT NULL, scopes text[] NOT NULL, project_ids uuid[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz);
CREATE TABLE projects (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), revision bigint NOT NULL DEFAULT 1, UNIQUE(organization_id,id));
CREATE TABLE workspaces (LIKE projects INCLUDING ALL);
ALTER TABLE workspaces ADD COLUMN project_id uuid NOT NULL, ADD CONSTRAINT workspace_org_fk FOREIGN KEY(organization_id) REFERENCES organizations(id), ADD CONSTRAINT workspace_project_fk FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id);
CREATE TABLE agents (LIKE projects INCLUDING ALL);
CREATE TABLE sessions (LIKE projects INCLUDING ALL);
ALTER TABLE sessions ADD COLUMN workspace_id uuid NOT NULL, ADD CONSTRAINT session_workspace_fk FOREIGN KEY(organization_id,workspace_id) REFERENCES workspaces(organization_id,id);
CREATE TABLE connections (LIKE projects INCLUDING ALL);
CREATE TABLE checkpoints (LIKE projects INCLUDING ALL);
CREATE TABLE artifacts (LIKE projects INCLUDING ALL);
CREATE TABLE webhooks (LIKE projects INCLUDING ALL);
CREATE TABLE deliveries (LIKE projects INCLUDING ALL);
CREATE TABLE operations (LIKE projects INCLUDING ALL);
CREATE TABLE transfers (LIKE projects INCLUDING ALL);
CREATE TABLE runs (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), workspace_id uuid NOT NULL, session_id uuid NOT NULL,
 project_id uuid NOT NULL, status text NOT NULL CHECK(status IN ('queued','provisioning','running','waiting_for_input','persisting','succeeded','failed','cancelled','timed_out')),
 config jsonb NOT NULL, result jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
 queue_expires_at timestamptz NOT NULL DEFAULT now()+interval '1 hour', deadline timestamptz, lease_generation bigint NOT NULL DEFAULT 0, heartbeat_at timestamptz,
 cancel_requested boolean NOT NULL DEFAULT false, event_sequence bigint NOT NULL DEFAULT 0, reservation_micro_usd bigint NOT NULL DEFAULT 0,
 cost_micro_usd bigint NOT NULL DEFAULT 0, execution_binding jsonb, input_request jsonb,
 FOREIGN KEY(organization_id,workspace_id) REFERENCES workspaces(organization_id,id), FOREIGN KEY(organization_id,session_id) REFERENCES sessions(organization_id,id), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX one_workspace_writer ON runs(workspace_id) WHERE status IN ('provisioning','running','waiting_for_input','persisting');
CREATE INDEX pending_runs ON runs(created_at) WHERE status='queued';
CREATE INDEX tenant_runs ON runs(organization_id,created_at DESC,id);
CREATE TABLE run_events (id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid NOT NULL, sequence bigint NOT NULL, type text NOT NULL, data jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now(), ingested_at timestamptz NOT NULL DEFAULT now(), producer_id text, producer_sequence bigint, UNIQUE(run_id,sequence), UNIQUE(run_id,producer_id,producer_sequence), FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id));
CREATE TABLE idempotency (organization_id uuid NOT NULL, principal_id text NOT NULL, route text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, response_ciphertext text NOT NULL, status integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,principal_id,route,key));
CREATE TABLE ledger (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), journal_id uuid NOT NULL, account text NOT NULL, amount_micro_usd bigint NOT NULL, reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(journal_id,account));
CREATE TABLE financial_events (organization_id uuid NOT NULL REFERENCES organizations(id), reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,reference));
CREATE TABLE model_usage (id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid NOT NULL, request_id text NOT NULL UNIQUE, provider text NOT NULL, model text NOT NULL, billing_mode text NOT NULL, input_tokens bigint, output_tokens bigint, cost_micro_usd bigint, completeness text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id));
CREATE TABLE api_requests (request_id uuid PRIMARY KEY, organization_id uuid, principal_id text, principal_type text, user_id text, method text NOT NULL, route text NOT NULL, status integer, duration_ms integer, client_type text NOT NULL DEFAULT 'api', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX requests_tenant_time ON api_requests(organization_id,created_at DESC);
CREATE TABLE product_events (id uuid PRIMARY KEY, organization_id uuid, user_id text, name text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE actor_activity (id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX activity_time ON actor_activity(created_at,user_id);
CREATE TABLE admin_audit (id uuid PRIMARY KEY, operator_id text NOT NULL, action text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE dispatch_jobs (id uuid PRIMARY KEY, organization_id uuid NOT NULL, kind text NOT NULL, resource_id uuid NOT NULL, state text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, error text, UNIQUE(kind,resource_id));
CREATE TABLE platform_meta (key text PRIMARY KEY, data jsonb NOT NULL);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['projects','workspaces','agents','sessions','connections','checkpoints','artifacts','webhooks','deliveries','operations','transfers','runs','run_events','idempotency','ledger','financial_events','model_usage','actor_activity'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id::text = current_setting(''app.organization_id'',true)) WITH CHECK (organization_id::text = current_setting(''app.organization_id'',true))', t);
 END LOOP;
END $$;
