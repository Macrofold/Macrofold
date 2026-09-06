CREATE TABLE tool_invocations (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,run_id uuid NOT NULL,connection_id uuid NOT NULL,
 call_key text NOT NULL,fingerprint text NOT NULL,tool_name text NOT NULL,status text NOT NULL,
 cost_micro_usd bigint NOT NULL DEFAULT 0,result_ciphertext text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(run_id,call_key),FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES connections(organization_id,id)
);
ALTER TABLE tool_invocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_invocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tool_invocations USING(organization_id::text=current_setting('app.organization_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
