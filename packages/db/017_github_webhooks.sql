-- Routing contains only installation/tenant identifiers. Content remains behind FORCE RLS.
ALTER TABLE github_installations ADD COLUMN active boolean NOT NULL DEFAULT true;
CREATE TABLE github_webhook_routes (
 installation_id text NOT NULL, organization_id uuid NOT NULL,
 PRIMARY KEY(installation_id,organization_id),
 FOREIGN KEY(organization_id,installation_id) REFERENCES github_installations(organization_id,installation_id) ON DELETE CASCADE
);
INSERT INTO github_webhook_routes SELECT installation_id,organization_id FROM github_installations;
CREATE TABLE github_webhook_receipts (
 delivery_id uuid PRIMARY KEY, event text NOT NULL, body_sha256 text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX github_receipts_age ON github_webhook_receipts(received_at);
