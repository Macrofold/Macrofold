-- Operator/billing changes can free account capacity without completing a Run.
CREATE TRIGGER dispatch_organization_policy AFTER UPDATE OF plan,run_concurrency_limit,run_timeout_seconds ON organizations
FOR EACH ROW WHEN (OLD.plan IS DISTINCT FROM NEW.plan
  OR OLD.run_concurrency_limit IS DISTINCT FROM NEW.run_concurrency_limit
  OR OLD.run_timeout_seconds IS DISTINCT FROM NEW.run_timeout_seconds)
EXECUTE FUNCTION notify_dispatch_wakeup();
