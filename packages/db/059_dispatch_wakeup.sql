-- Empty notifications are committed hints, never resource identity/authority.
-- Identical hints coalesce within a transaction; missed hints use normal polling.
CREATE FUNCTION notify_dispatch_wakeup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='runs' THEN
    -- Direct completions can free shared capacity for another tenant. With no
    -- queued work, however, notifying every LLM response creates empty scans.
    -- The existing queued-only index makes this content-free existence probe
    -- independent of retained history; the reporting view preserves RLS.
    IF NEW.kind<>'native_agent' AND NOT EXISTS(
      SELECT 1 FROM reporting.scheduling_runs WHERE status='queued'
    ) THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM pg_notify('macrofold_dispatch_wakeup','');
  RETURN NULL;
END;
$$;

CREATE TRIGGER dispatch_due_insert AFTER INSERT ON dispatch_jobs
FOR EACH ROW WHEN (NEW.kind='run' AND NEW.state IN ('pending','running')
  AND NEW.available_at<=clock_timestamp()) EXECUTE FUNCTION notify_dispatch_wakeup();

CREATE TRIGGER dispatch_due_update AFTER UPDATE OF state,available_at ON dispatch_jobs
FOR EACH ROW WHEN (NEW.kind='run' AND NEW.state IN ('pending','running')
  AND NEW.available_at<=clock_timestamp()
  AND (OLD.state IS DISTINCT FROM NEW.state OR OLD.available_at IS DISTINCT FROM NEW.available_at))
EXECUTE FUNCTION notify_dispatch_wakeup();

-- Cancellation of a queued head can unblock a Worktree without freeing a slot.
CREATE TRIGGER dispatch_run_finished AFTER UPDATE OF status ON runs
FOR EACH ROW WHEN (NEW.status IN ('succeeded','failed','cancelled','timed_out')
  AND OLD.status NOT IN ('succeeded','failed','cancelled','timed_out'))
EXECUTE FUNCTION notify_dispatch_wakeup();

CREATE TRIGGER dispatch_host_ready AFTER UPDATE OF status ON hosts
FOR EACH ROW WHEN (NEW.status='ready' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION notify_dispatch_wakeup();

-- Warm Hosts remain ready after a Run. Their assignment/writer release, rather
-- than the earlier terminal Run status, makes the next placement eligible.
CREATE TRIGGER dispatch_assignment_released AFTER UPDATE OF released_at ON host_runs
FOR EACH ROW WHEN (OLD.released_at IS NULL AND NEW.released_at IS NOT NULL)
EXECUTE FUNCTION notify_dispatch_wakeup();

CREATE TRIGGER dispatch_worker_policy AFTER UPDATE OF desired_state,settings ON workers
FOR EACH ROW WHEN (OLD.desired_state IS DISTINCT FROM NEW.desired_state
  OR OLD.settings IS DISTINCT FROM NEW.settings)
EXECUTE FUNCTION notify_dispatch_wakeup();
