-- Optional customer-agent integration path. Execution and permission state remain
-- in the existing core resources; these tables only retain application bindings.
CREATE TABLE customer_agent_bindings (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 owner_user_id text NOT NULL REFERENCES auth."user"(id),
 customer_id text NOT NULL CHECK (length(customer_id) BETWEEN 1 AND 200),
 agent_key text NOT NULL CHECK (length(agent_key) BETWEEN 1 AND 100),
 name text NOT NULL,
 project_id uuid NOT NULL,
 agent_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (organization_id,id),
 UNIQUE (organization_id,owner_user_id,customer_id,agent_key),
 UNIQUE (project_id),
 FOREIGN KEY (organization_id,project_id) REFERENCES projects(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,agent_id) REFERENCES agents(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,workspace_id) REFERENCES workspaces(organization_id,id) ON DELETE CASCADE
);
CREATE TABLE customer_agent_connections (
 organization_id uuid NOT NULL,
 binding_id uuid NOT NULL,
 connection_id uuid PRIMARY KEY,
 capabilities jsonb NOT NULL,
 selected_capabilities text[] NOT NULL DEFAULT '{}',
 FOREIGN KEY (organization_id,binding_id) REFERENCES customer_agent_bindings(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,connection_id) REFERENCES connections(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX customer_agent_connections_binding ON customer_agent_connections(binding_id,connection_id);
CREATE TABLE customer_connection_authorizations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 binding_id uuid NOT NULL,
 connection_id uuid NOT NULL,
 principal jsonb NOT NULL,
 return_url text NOT NULL,
 ticket_hash text NOT NULL,
 access_version bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','starting','authorizing','awaiting_confirmation','verifying','verified','completed','failed')),
 selected_capabilities text[] NOT NULL DEFAULT '{}',
 provider_session_ciphertext text,
 completion_hash text,
 external_account_id text,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (organization_id,binding_id) REFERENCES customer_agent_bindings(organization_id,id) ON DELETE CASCADE,
 FOREIGN KEY (organization_id,connection_id) REFERENCES connections(organization_id,id) ON DELETE CASCADE
);
CREATE INDEX customer_connection_authorizations_expiry ON customer_connection_authorizations(expires_at);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['customer_agent_bindings','customer_agent_connections','customer_connection_authorizations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id::text=current_setting(''app.organization_id'',true)) WITH CHECK (organization_id::text=current_setting(''app.organization_id'',true))', t);
 END LOOP;
END $$;
