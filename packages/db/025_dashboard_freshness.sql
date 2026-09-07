-- Current resource revisions, not an event log. Sequence gaps/commit ordering are
-- immaterial: dashboard delivery is best effort and clients reconcile periodically.
-- No shared organization row is locked by unrelated workspace writers.
CREATE SEQUENCE dashboard_revision_sequence;
ALTER TABLE runs ADD COLUMN dashboard_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN dashboard_revision bigint NOT NULL DEFAULT 0,
 ADD COLUMN dashboard_git_revision bigint NOT NULL DEFAULT 0;
ALTER TABLE checkpoints ADD COLUMN dashboard_revision bigint NOT NULL DEFAULT 0;
CREATE INDEX dashboard_runs_revision ON runs(organization_id,dashboard_revision DESC);
CREATE INDEX dashboard_workspaces_revision ON workspaces(organization_id,dashboard_revision DESC);
CREATE INDEX dashboard_git_revision ON workspaces(organization_id,dashboard_git_revision DESC);
CREATE INDEX dashboard_checkpoints_revision ON checkpoints(organization_id,dashboard_revision DESC);

CREATE FUNCTION stamp_dashboard_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.dashboard_revision := nextval('dashboard_revision_sequence');
 RETURN NEW;
END $$;
CREATE TRIGGER dashboard_run_created BEFORE INSERT ON runs
 FOR EACH ROW EXECUTE FUNCTION stamp_dashboard_revision();
-- Detailed output, tool events, token accounting and heartbeats stay off this path.
CREATE TRIGGER dashboard_run_changed BEFORE UPDATE OF status,cancel_requested,input_request,result ON runs
 FOR EACH ROW WHEN ((OLD.status,OLD.cancel_requested,OLD.input_request,OLD.result)
 IS DISTINCT FROM (NEW.status,NEW.cancel_requested,NEW.input_request,NEW.result))
 EXECUTE FUNCTION stamp_dashboard_revision();
CREATE TRIGGER dashboard_workspace_created BEFORE INSERT ON workspaces
 FOR EACH ROW EXECUTE FUNCTION stamp_dashboard_revision();
CREATE TRIGGER dashboard_workspace_changed BEFORE UPDATE OF data ON workspaces
 FOR EACH ROW WHEN (OLD.data IS DISTINCT FROM NEW.data)
 EXECUTE FUNCTION stamp_dashboard_revision();
CREATE TRIGGER dashboard_checkpoint_created BEFORE INSERT ON checkpoints
 FOR EACH ROW EXECUTE FUNCTION stamp_dashboard_revision();
CREATE FUNCTION stamp_dashboard_git_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW.dashboard_git_revision := nextval('dashboard_revision_sequence');
 RETURN NEW;
END $$;
CREATE TRIGGER dashboard_git_changed BEFORE UPDATE OF data ON workspaces
 FOR EACH ROW WHEN (OLD.data->'sync' IS DISTINCT FROM NEW.data->'sync')
 EXECUTE FUNCTION stamp_dashboard_git_revision();
