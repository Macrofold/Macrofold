CREATE TABLE provider_circuit_breakers (
  key text PRIMARY KEY,
  reason text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  occurrences bigint NOT NULL DEFAULT 1,
  resolved_at timestamptz
);
