-- Orchestration ownership is separate from the native execution lease. A
-- continuation or recovered worker must retain the same VM and reservation.
ALTER TABLE dispatch_jobs ADD COLUMN workflow_generation integer NOT NULL DEFAULT 0;
