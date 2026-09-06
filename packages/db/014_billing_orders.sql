CREATE TABLE billing_orders (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), request_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN('topup','subscription')), expected_micro_usd bigint NOT NULL DEFAULT 0,
 customer_id text NOT NULL, session_id text UNIQUE, checkout_url text, status text NOT NULL DEFAULT 'pending', expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,request_key)
);
CREATE TABLE billing_payments (
 payment_intent_id text PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id), reference text NOT NULL,
 cash_micro_usd bigint NOT NULL CHECK(cash_micro_usd>0), funded_micro_usd bigint NOT NULL CHECK(funded_micro_usd>=0),
 refunded_micro_usd bigint NOT NULL DEFAULT 0, reversed_micro_usd bigint NOT NULL DEFAULT 0,
 disputes jsonb NOT NULL DEFAULT '{}', credit_expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE billing_events(id text PRIMARY KEY, type text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX stripe_customer_binding ON organizations((settings->>'stripe_customer_id')) WHERE settings ? 'stripe_customer_id';
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['billing_orders','billing_payments'] LOOP
EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(organization_id::text=current_setting(''app.organization_id'',true)) WITH CHECK(organization_id::text=current_setting(''app.organization_id'',true))',t);
END LOOP; END $$;
