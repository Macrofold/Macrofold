-- Forward-only rollout of the verified queue/history policy. Migration 024
-- already set this default on some installations; reassert it without rewriting
-- any accepted deadline, terminal result, execution lease, event, or ledger row.
-- Admission writes an explicit (optionally shorter) per-request deadline.
ALTER TABLE runs ALTER COLUMN queue_expires_at SET DEFAULT now()+interval '24 hours';
