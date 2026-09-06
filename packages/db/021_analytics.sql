-- Metadata only; these indexes keep growth and request reports independent of customer content.
CREATE INDEX runs_activation ON runs(organization_id,completed_at) WHERE status='succeeded' AND config->>'model'<>'fixture-model';
CREATE INDEX product_events_org_time ON product_events(organization_id,created_at);
CREATE INDEX requests_time_status ON api_requests(created_at,status);
CREATE TABLE report_snapshots (day date PRIMARY KEY, observed_at timestamptz NOT NULL DEFAULT now(), report jsonb NOT NULL);
-- Mutable daily acquisition/cohort views are computed at observation time; snapshots preserve
-- what the operator actually saw. They are append-only apart from explicit retention.
