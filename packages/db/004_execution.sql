CREATE TABLE execution_objects (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, run_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('input_chunk','input_page','output_chunk','output_entry')),
 name text NOT NULL, data jsonb NOT NULL, processed boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,kind,name), FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id)
);
CREATE INDEX execution_objects_pending ON execution_objects(run_id,kind,name) WHERE NOT processed;
ALTER TABLE execution_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON execution_objects USING(organization_id::text=current_setting('app.organization_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
