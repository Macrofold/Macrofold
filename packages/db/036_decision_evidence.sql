-- Definitions are independent project content; run history expiry cannot delete them.
CREATE TABLE decision_definitions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
 name text NOT NULL, revision text NOT NULL, definition jsonb NOT NULL, digest text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), withdrawn_at timestamptz,
 UNIQUE(organization_id,project_id,name,revision),
 FOREIGN KEY(organization_id,project_id) REFERENCES projects(organization_id,id)
);
ALTER TABLE decision_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON decision_definitions
 USING(organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
