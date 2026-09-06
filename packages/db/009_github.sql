-- User OAuth proves installation access; an installation_id callback alone is never proof.
CREATE TABLE github_user_links (organization_id uuid NOT NULL REFERENCES organizations(id), user_id text NOT NULL REFERENCES auth."user"(id) ON DELETE CASCADE, token_ciphertext text NOT NULL, expires_at timestamptz NOT NULL, PRIMARY KEY(organization_id,user_id));
CREATE TABLE github_repository_grants (organization_id uuid NOT NULL REFERENCES organizations(id), installation_id text NOT NULL, repository_id text NOT NULL, full_name text NOT NULL, default_branch text NOT NULL, granted_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(organization_id,installation_id,repository_id));
CREATE TABLE oauth_attempts (id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), user_id text NOT NULL, provider text NOT NULL, data jsonb NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz);
ALTER TABLE github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_installations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON github_installations USING(organization_id::text=current_setting('app.organization_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['github_user_links','github_repository_grants','oauth_attempts'] LOOP
EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(organization_id::text=current_setting(''app.organization_id'',true)) WITH CHECK(organization_id::text=current_setting(''app.organization_id'',true))',t);
END LOOP; END $$;
