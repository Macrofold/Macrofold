CREATE TABLE storage_objects (
 organization_id uuid NOT NULL REFERENCES organizations(id), key text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes>=0), modified_at timestamptz NOT NULL,
 seen_at timestamptz NOT NULL DEFAULT now(), unreferenced_since timestamptz,
 children jsonb, PRIMARY KEY(organization_id,key)
);
CREATE TABLE storage_state (
 organization_id uuid PRIMARY KEY REFERENCES organizations(id), cursor text,
 scan_started_at timestamptz NOT NULL DEFAULT now(), scanned_at timestamptz,
 physical_bytes bigint NOT NULL DEFAULT 0, object_count bigint NOT NULL DEFAULT 0,
 gc_deleted_objects bigint NOT NULL DEFAULT 0, observed_at timestamptz,
 billing_at timestamptz NOT NULL DEFAULT now(), billing_remainder numeric NOT NULL DEFAULT 0
);
CREATE TABLE storage_usage (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 observed_at timestamptz NOT NULL, physical_bytes bigint NOT NULL, object_count bigint NOT NULL,
 charged_micro_usd bigint NOT NULL DEFAULT 0, UNIQUE(organization_id,observed_at)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['storage_objects','storage_state','storage_usage'] LOOP
EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(organization_id::text=current_setting(''app.organization_id'',true)) WITH CHECK(organization_id::text=current_setting(''app.organization_id'',true))',t);
END LOOP; END $$;
ALTER TABLE organizations ADD COLUMN storage_due_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX organization_storage_due ON organizations(storage_due_at);
