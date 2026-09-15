-- Deployment setup contains no customer credentials and is read-only to serving roles.
CREATE TABLE trigger_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  definition_limit integer NOT NULL DEFAULT 100 CHECK (definition_limit BETWEEN 0 AND 1000000)
);
INSERT INTO trigger_policy DEFAULT VALUES;
ALTER TABLE organizations ADD COLUMN trigger_definition_limit integer
  CHECK (trigger_definition_limit BETWEEN 0 AND 1000000);

CREATE TABLE connector_enablement (
  toolkit text PRIMARY KEY,
  auth_config_id text,
  toolkit_version text NOT NULL CHECK (toolkit_version <> 'latest' AND length(toolkit_version) > 0),
  enabled boolean NOT NULL DEFAULT false,
  creation_pending boolean NOT NULL DEFAULT false,
  CHECK (NOT enabled OR (auth_config_id IS NOT NULL AND NOT creation_pending)),
  updated_at timestamptz NOT NULL DEFAULT now()
);
