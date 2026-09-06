ALTER TABLE organizations ADD COLUMN credit_debt_micro_usd bigint NOT NULL DEFAULT 0 CHECK(credit_debt_micro_usd>=0);
CREATE TABLE credit_lots (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), reference text NOT NULL,
 kind text NOT NULL, original_micro_usd bigint NOT NULL CHECK(original_micro_usd>0), remaining_micro_usd bigint NOT NULL CHECK(remaining_micro_usd>=0),
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,reference)
);
-- Preserve the existing aggregate projection when upgrading a development or early deployment database.
INSERT INTO credit_lots(id,organization_id,reference,kind,original_micro_usd,remaining_micro_usd)
 SELECT gen_random_uuid(),id,'migration:opening-balance','purchased_credits',balance_micro_usd,balance_micro_usd FROM organizations WHERE balance_micro_usd>0;
UPDATE organizations SET credit_debt_micro_usd=-balance_micro_usd WHERE balance_micro_usd<0;
ALTER TABLE credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_lots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credit_lots USING(organization_id::text=current_setting('app.organization_id',true)) WITH CHECK(organization_id::text=current_setting('app.organization_id',true));
CREATE INDEX credit_lots_spendable ON credit_lots(organization_id,expires_at,created_at) WHERE remaining_micro_usd>0;
