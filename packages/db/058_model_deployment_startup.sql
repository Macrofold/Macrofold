-- Model readiness gets a separate durable phase after allocation/image startup.
-- The original startup_at remains the absolute episode fence across recovery.
ALTER TABLE model_deployments ADD COLUMN readiness_started_at timestamptz;
