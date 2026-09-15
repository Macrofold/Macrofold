-- Global, non-customer metadata. Failed refreshes retain the last complete snapshot.
CREATE TABLE model_catalog_cache (
  provider text PRIMARY KEY CHECK (provider IN ('openai','anthropic','openrouter')),
  models jsonb CHECK (models IS NULL OR jsonb_typeof(models)='array'),
  fetched_at timestamptz,
  refresh_after timestamptz NOT NULL DEFAULT now(),
  refresh_token uuid,
  last_error text CHECK (last_error IS NULL OR last_error='discovery_failed')
);
INSERT INTO model_catalog_cache(provider) VALUES ('openai'),('anthropic'),('openrouter');
