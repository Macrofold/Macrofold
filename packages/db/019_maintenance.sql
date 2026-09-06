ALTER TABLE organizations ADD COLUMN maintenance_due_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX organization_maintenance_due ON organizations(maintenance_due_at);
CREATE TABLE maintenance_observations (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id), observed_at timestamptz NOT NULL,
 financial jsonb NOT NULL, storage jsonb NOT NULL DEFAULT '{}'
);
ALTER TABLE maintenance_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON maintenance_observations USING(organization_id::text=current_setting('app.organization_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
GRANT SELECT ON maintenance_observations TO platform_reporting;
CREATE POLICY reporting_read ON maintenance_observations FOR SELECT TO platform_reporting USING(true);
CREATE VIEW reporting.maintenance AS SELECT organization_id,observed_at,financial,storage FROM maintenance_observations;
ALTER VIEW reporting.maintenance OWNER TO platform_reporting;
