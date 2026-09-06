ALTER TABLE runs ADD COLUMN budget_used_micro_usd bigint NOT NULL DEFAULT 0 CHECK(budget_used_micro_usd>=0), ADD COLUMN model_reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK(model_reserved_micro_usd>=0);
CREATE TABLE gateway_requests (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,run_id uuid NOT NULL,lease_generation bigint NOT NULL,
 model text NOT NULL,provider text NOT NULL,billing_mode text NOT NULL,status text NOT NULL,
 reserved_micro_usd bigint NOT NULL,actual_micro_usd bigint,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 FOREIGN KEY(organization_id,run_id) REFERENCES runs(organization_id,id)
);
ALTER TABLE gateway_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateway_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON gateway_requests USING(organization_id::text=current_setting('app.organization_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
ALTER TABLE model_usage ADD COLUMN usage_details jsonb NOT NULL DEFAULT '{}';
