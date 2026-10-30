-- Quiescent services leave the due queue. Early 056 installations required a
-- timestamp; allow the reconciler's NULL without rewriting data or that migration.
ALTER TABLE model_deployments ALTER COLUMN next_check_at DROP NOT NULL;
