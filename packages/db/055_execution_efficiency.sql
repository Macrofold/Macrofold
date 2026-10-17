-- Validate input shape only when input/identity changes. A CHECK constraint on
-- every heartbeat/financial update needlessly decompresses executable input.
ALTER TABLE runs DROP CONSTRAINT run_kind_shape;
CREATE FUNCTION validate_run_kind_shape() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT (
   (NEW.kind='native_agent' AND NEW.worktree_id IS NOT NULL AND NEW.session_id IS NOT NULL
     AND NEW.config ? 'harness') OR
   (NEW.kind IN ('inference','bounded_agent') AND NEW.worktree_id IS NULL AND NEW.session_id IS NULL
     AND NOT NEW.config ? 'harness' AND NEW.config->>'executor_version'='1'
     AND ((NEW.config ? 'definition' AND NEW.config ? 'context') OR
       (NEW.kind='inference' AND NEW.config->>'payload_kind'='compact'
        AND NEW.config ?& ARRAY['definition_revision','schema_digest','context_audience','dependency_tokens']) OR
       (NEW.config->>'payload_kind'='task_wake' AND NEW.config ?& ARRAY['task_id','task_wake_id','context_control','task_input_digest','context_appendix','definition'])))
 ) IS TRUE THEN
   RAISE EXCEPTION 'Run input does not match its execution kind' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER run_kind_shape BEFORE INSERT OR UPDATE OF config,kind,worktree_id,session_id
 ON runs FOR EACH ROW EXECUTE FUNCTION validate_run_kind_shape();

-- Bounded agents use the same API-key current-authority observer. It exposes
-- control facts only and never gives access to payloads or credentials.
CREATE OR REPLACE VIEW reporting.inference_control WITH(security_barrier=true) AS
 SELECT r.id,r.organization_id,r.lease_generation,r.status,r.cancel_requested,r.deadline,
   m.role AS member_role,coalesce(u."emailVerified",false) AS email_verified,
   k.id IS NOT NULL AS key_bound,k.revoked_at IS NOT NULL AS key_revoked,
   coalesce(k.expires_at<=now(),false) AS key_expired,
   coalesce('runs:write'=ANY(k.scopes),false) AS scope_allowed,
   coalesce(cardinality(k.workspace_ids)=0 OR r.workspace_id=ANY(k.workspace_ids),false) AS workspace_allowed,
   true AS worker_allowed
 FROM runs r
 LEFT JOIN memberships m ON m.organization_id=r.organization_id AND m.user_id=r.config->>'user_id'
 LEFT JOIN auth."user" u ON u.id=m.user_id
 LEFT JOIN api_keys k ON k.id=(r.config->>'principal_id')::uuid
   AND k.organization_id=r.organization_id AND k.user_id=r.config->>'user_id'
 WHERE r.kind IN ('inference','bounded_agent') AND r.config->>'principal_kind'='api_key';
ALTER VIEW reporting.inference_control OWNER TO platform_reporting;

-- Strict stop-on-model-error admission inspects only unsettled requests.
CREATE INDEX gateway_requests_pending ON gateway_requests(run_id,created_at,id) WHERE status='in_flight';

-- Fleet scheduling may inspect only whether an accepted trigger needs dispatch
-- or delivery. Tenant content and final authorization stay with its owner.
GRANT SELECT(id,organization_id,run_id) ON trigger_deliveries TO platform_reporting;
CREATE POLICY reporting_read ON trigger_deliveries FOR SELECT TO platform_reporting USING(true);
CREATE VIEW reporting.trigger_dispatch WITH(security_barrier=true) AS
 SELECT id,organization_id,(run_id IS NOT NULL) AS reply_phase FROM trigger_deliveries;
ALTER VIEW reporting.trigger_dispatch OWNER TO platform_reporting;

-- One immutable source inventory per restore, paged through the existing I/O
-- journal; phase control must not rescan a large JSONB file tree for every page.
ALTER TABLE execution_objects DROP CONSTRAINT execution_objects_kind_check;
ALTER TABLE execution_objects ADD CONSTRAINT execution_objects_kind_check
 CHECK(kind IN ('input_chunk','input_page','output_entry','output_chunk','input_source'));

-- Public discovery payloads are immutable at a revision. Keep current revision
-- and freshness cheap to read without repeatedly transferring the full catalog.
ALTER TABLE model_catalog_cache ADD COLUMN revision uuid NOT NULL DEFAULT gen_random_uuid();
CREATE FUNCTION revise_model_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.models IS DISTINCT FROM OLD.models THEN
    NEW.revision := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER model_catalog_revision BEFORE UPDATE OF models ON model_catalog_cache
 FOR EACH ROW EXECUTE FUNCTION revise_model_catalog();
