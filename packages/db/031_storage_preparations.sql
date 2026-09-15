-- Bounded object preparation can outlive a SQL transaction. GC must not collect
-- its source or newly written objects before the final revision-checked commit.
CREATE TABLE storage_preparations (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES organizations(id),
 expires_at timestamptz NOT NULL
);
CREATE INDEX storage_preparation_expiry ON storage_preparations(organization_id, expires_at);
ALTER TABLE storage_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_preparations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storage_preparations
 USING(organization_id::text=current_setting('app.organization_id',true))
 WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
