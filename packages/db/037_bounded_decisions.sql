ALTER TABLE decision_invocations ADD COLUMN handled_at timestamptz,
 ADD COLUMN context_digest text, ADD COLUMN context_expires_at timestamptz, ADD COLUMN output_token_bound integer,
 ADD COLUMN dependency_tokens jsonb NOT NULL DEFAULT '{}',
 ADD COLUMN timings_ms jsonb NOT NULL DEFAULT '{}';
CREATE TABLE decision_tool_steps (
 organization_id uuid NOT NULL, run_id uuid NOT NULL, step integer NOT NULL,
 artifact_id uuid NOT NULL, result_ciphertext text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(run_id,step),
 FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id),
 FOREIGN KEY(artifact_id) REFERENCES artifacts(id)
);
ALTER TABLE decision_tool_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_tool_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON decision_tool_steps
 USING(organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
