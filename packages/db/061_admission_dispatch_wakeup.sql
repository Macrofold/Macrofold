-- A current-head poller can lease the only eligible hint while its sibling
-- sleeps. Admission exposes the next fair head; wake siblings at commit without
-- making the admitted job due or disturbing its phase/recovery ownership.
CREATE OR REPLACE FUNCTION notify_dispatch_wakeup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='runs' THEN
    -- New fair heads and lightweight completions need no fleet scan when the
    -- queue is empty. This uses the queued-only index, not retained history.
    IF (NEW.status='provisioning' OR NEW.kind<>'native_agent') AND NOT EXISTS(
      SELECT 1 FROM reporting.scheduling_runs WHERE status='queued'
    ) THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM pg_notify('macrofold_dispatch_wakeup','');
  RETURN NULL;
END;
$$;

CREATE TRIGGER dispatch_run_admitted AFTER UPDATE OF status ON runs
FOR EACH ROW WHEN (OLD.status='queued' AND NEW.status='provisioning')
EXECUTE FUNCTION notify_dispatch_wakeup();
