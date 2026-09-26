-- A final runtime receipt and a settled financial cursor are different facts.
-- Preserve the receipt before stopping compute, even when settlement must wait.
ALTER TABLE hosts ADD COLUMN final_usage jsonb
 CHECK(final_usage IS NULL OR (jsonb_typeof(final_usage)='object' AND usage_finalized_at IS NOT NULL));
