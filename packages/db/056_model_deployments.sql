-- Model services have independent lifecycle/cost observations. Hosting does not
-- manufacture an agent Run or a second financial ledger.
CREATE TABLE model_deployments (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES organizations(id),
 owner_subject_id text NOT NULL REFERENCES auth."user"(id), name text NOT NULL,
 desired_state text NOT NULL DEFAULT 'stopped' CHECK(desired_state IN ('running','stopped')),
 desired_revision_id uuid, serving_revision_id uuid,
 state text NOT NULL DEFAULT 'stopped' CHECK(state IN ('stopped','starting','ready','degraded','stopping','failed','cleanup_pending')),
 policy jsonb, accepted_rates jsonb, generation bigint NOT NULL DEFAULT 0, retired boolean NOT NULL DEFAULT false,
 ready_replicas integer, observed_at timestamptz, failure_code text,
 next_check_at timestamptz, lease_id uuid, lease_until timestamptz,
 failure_attempts integer NOT NULL DEFAULT 0, startup_at timestamptz, drain_started_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id)
);
CREATE INDEX model_deployments_listing ON model_deployments(organization_id,id DESC);
CREATE INDEX model_deployments_due ON model_deployments(next_check_at,id) WHERE next_check_at IS NOT NULL;
CREATE TABLE model_deployment_revisions (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, deployment_id uuid NOT NULL,
 source jsonb NOT NULL, runtime jsonb NOT NULL, hosting jsonb NOT NULL, capabilities jsonb NOT NULL,
 source_evidence jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,deployment_id) REFERENCES model_deployments(organization_id,id),
 UNIQUE(organization_id,deployment_id,id)
);
CREATE INDEX model_deployment_revisions_listing ON model_deployment_revisions(deployment_id,id DESC);
ALTER TABLE model_deployments ADD FOREIGN KEY(organization_id,id,desired_revision_id)
 REFERENCES model_deployment_revisions(organization_id,deployment_id,id);
ALTER TABLE model_deployments ADD FOREIGN KEY(organization_id,id,serving_revision_id)
 REFERENCES model_deployment_revisions(organization_id,deployment_id,id);
CREATE FUNCTION immutable_model_deployment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Model deployment revisions are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON model_deployment_revisions
 FOR EACH ROW EXECUTE FUNCTION immutable_model_deployment_revision();
CREATE TABLE model_deployment_grants (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, deployment_id uuid NOT NULL,
 subject_kind text NOT NULL CHECK(subject_kind IN ('subject','api_key')), subject_id text NOT NULL,
 workspace_ids uuid[], approved_by text NOT NULL REFERENCES auth."user"(id),
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 FOREIGN KEY(organization_id,deployment_id) REFERENCES model_deployments(organization_id,id),
 CHECK(workspace_ids IS NULL OR cardinality(workspace_ids) BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX model_deployment_grant_active ON model_deployment_grants
 (deployment_id,subject_kind,subject_id,coalesce(workspace_ids,'{}'::uuid[])) WHERE revoked_at IS NULL;
CREATE INDEX model_deployment_grant_subject ON model_deployment_grants(deployment_id,subject_kind,subject_id) WHERE revoked_at IS NULL;
CREATE INDEX model_deployment_grants_listing ON model_deployment_grants(deployment_id,id DESC);
CREATE TABLE model_deployment_connections (
 organization_id uuid NOT NULL, deployment_id uuid NOT NULL, revision_id uuid NOT NULL,
 connection_id uuid NOT NULL, approved_by text NOT NULL REFERENCES auth."user"(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(deployment_id,revision_id,connection_id),
 FOREIGN KEY(organization_id,deployment_id,revision_id) REFERENCES model_deployment_revisions(organization_id,deployment_id,id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES connections(organization_id,id)
);
CREATE TABLE model_deployment_resources (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, deployment_id uuid NOT NULL, revision_id uuid NOT NULL,
 connection_id uuid NOT NULL, attempt_id uuid NOT NULL, provider_id text, endpoint_url text,
 secret_ciphertext text NOT NULL, cleanup_secret_ciphertext text, config jsonb NOT NULL, accepted_rates jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('creating','ambiguous','starting','ready','stopping','deleted','cleanup_pending')),
 created_at timestamptz NOT NULL DEFAULT now(), stopped_at timestamptz, deleted_at timestamptz,
 observed_at timestamptz, cost_checked_at timestamptz, last_error text,
 FOREIGN KEY(organization_id,deployment_id,revision_id) REFERENCES model_deployment_revisions(organization_id,deployment_id,id),
 FOREIGN KEY(organization_id,connection_id) REFERENCES connections(organization_id,id),
 UNIQUE(organization_id,id), UNIQUE(attempt_id)
);
CREATE UNIQUE INDEX model_deployment_one_resource ON model_deployment_resources(deployment_id) WHERE deleted_at IS NULL;
CREATE INDEX model_deployment_connection_resources ON model_deployment_resources(connection_id,id) WHERE deleted_at IS NULL;
CREATE INDEX model_deployment_resources_listing ON model_deployment_resources(deployment_id,(deleted_at IS NULL) DESC,created_at DESC,id DESC);
CREATE INDEX model_deployment_historical_cost_due ON model_deployment_resources(deployment_id,deleted_at DESC,cost_checked_at,id) WHERE deleted_at IS NOT NULL AND provider_id IS NOT NULL;
CREATE TABLE model_deployment_cost_observations (
 organization_id uuid NOT NULL, resource_id uuid NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
 estimated_micro_usd bigint, provider_reported_micro_usd bigint, as_of timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(resource_id,period_start,period_end),
 FOREIGN KEY(organization_id,resource_id) REFERENCES model_deployment_resources(organization_id,id),
 CHECK(period_end>period_start), CHECK(estimated_micro_usd>=0), CHECK(provider_reported_micro_usd>=0)
);
CREATE INDEX model_deployment_cost_period ON model_deployment_cost_observations(organization_id,period_start,resource_id);
CREATE INDEX deployment_active_requests ON runs((config#>>'{deployment_target,deployment_id}'))
 WHERE status IN ('queued','provisioning','running','waiting_for_input','persisting');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['model_deployments','model_deployment_revisions','model_deployment_grants','model_deployment_connections','model_deployment_resources','model_deployment_cost_observations'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(organization_id::text=current_setting(''app.organization_id'',true)) WITH CHECK(organization_id::text=current_setting(''app.organization_id'',true))',t);
 END LOOP;
END $$;
-- The shared observer sees only a current allow/deny fact, never credentials or
-- mutable hosting observations. A normal stop/restart cannot invalidate output.
GRANT SELECT ON model_deployment_grants TO platform_reporting;
CREATE POLICY reporting_read ON model_deployment_grants FOR SELECT TO platform_reporting USING(true);
GRANT SELECT(id,organization_id,owner_subject_id) ON model_deployments TO platform_reporting;
GRANT SELECT(organization_id,deployment_id,revision_id,connection_id,approved_by) ON model_deployment_connections TO platform_reporting;
CREATE POLICY reporting_read ON model_deployment_connections FOR SELECT TO platform_reporting USING(true);
-- Only the fixed boolean view exposes these current connection facts. The
-- NOLOGIN reporting owner cannot be assumed by the serving application.
GRANT SELECT(id,organization_id,data) ON connections TO platform_reporting;
CREATE POLICY reporting_read ON connections FOR SELECT TO platform_reporting USING(true);
CREATE OR REPLACE VIEW reporting.inference_control WITH(security_barrier=true) AS
 SELECT r.id,r.organization_id,r.lease_generation,r.status,r.cancel_requested,r.deadline,
   m.role AS member_role,coalesce(u."emailVerified",false) AS email_verified,
   k.id IS NOT NULL AS key_bound,k.revoked_at IS NOT NULL AS key_revoked,
   coalesce(k.expires_at<=now(),false) AS key_expired,
   coalesce('runs:write'=ANY(k.scopes),false) AS scope_allowed,
   coalesce(cardinality(k.workspace_ids)=0 OR r.workspace_id=ANY(k.workspace_ids),false) AS workspace_allowed,
   true AS worker_allowed,
   (NOT r.config ? 'deployment_target' OR (
    'model-deployments:use'=ANY(k.scopes) AND EXISTS(
     SELECT 1 FROM model_deployment_grants g WHERE g.organization_id=r.organization_id
      AND g.deployment_id=(r.config#>>'{deployment_target,deployment_id}')::uuid AND g.revoked_at IS NULL
      AND ((g.subject_kind='api_key' AND g.subject_id=k.id::text) OR (g.subject_kind='subject' AND g.subject_id=k.user_id))
      AND (g.workspace_ids IS NULL OR r.workspace_id=ANY(g.workspace_ids))
   ) AND EXISTS(
    SELECT 1 FROM model_deployments d
    JOIN memberships owner_member ON owner_member.organization_id=d.organization_id AND owner_member.user_id=d.owner_subject_id AND owner_member.role IN ('owner','admin')
    JOIN auth."user" owner_user ON owner_user.id=owner_member.user_id AND owner_user."emailVerified"=true
    JOIN model_deployment_connections dc ON dc.deployment_id=d.id AND dc.organization_id=d.organization_id
      AND dc.revision_id=(r.config#>>'{deployment_target,deployment_revision_id}')::uuid AND dc.approved_by=d.owner_subject_id
    JOIN connections c ON c.id=dc.connection_id AND c.organization_id=d.organization_id
    WHERE d.id=(r.config#>>'{deployment_target,deployment_id}')::uuid AND d.organization_id=r.organization_id
      AND dc.connection_id=coalesce((r.config#>>'{deployment_target,endpoint_connection_id}')::uuid,(r.config#>>'{deployment_target,credential_connection_id}')::uuid)
      AND c.data->>'owner_subject_id'=d.owner_subject_id AND c.data->>'status'='healthy' AND coalesce(c.data->>'deleted','false')='false'
      AND ((r.config#>>'{deployment_target,endpoint_connection_id}' IS NULL AND c.data->>'kind'='runpod') OR
        (r.config#>>'{deployment_target,endpoint_connection_id}' IS NOT NULL AND c.data->>'kind'='external_model'
          AND c.data->>'url'=r.config#>>'{deployment_target,endpoint_url}'))
   ))) AS deployment_allowed
 FROM runs r
 LEFT JOIN memberships m ON m.organization_id=r.organization_id AND m.user_id=r.config->>'user_id'
 LEFT JOIN auth."user" u ON u.id=m.user_id
 LEFT JOIN api_keys k ON k.id=(r.config->>'principal_id')::uuid
   AND k.organization_id=r.organization_id AND k.user_id=r.config->>'user_id'
 WHERE r.kind IN ('inference','bounded_agent') AND r.config->>'principal_kind'='api_key';
ALTER VIEW reporting.inference_control OWNER TO platform_reporting;

GRANT SELECT(id,organization_id,next_check_at,lease_until) ON model_deployments TO platform_reporting;
CREATE POLICY reporting_read ON model_deployments FOR SELECT TO platform_reporting USING(true);
CREATE VIEW reporting.model_deployment_dispatch WITH(security_barrier=true) AS
 SELECT id,organization_id,next_check_at,lease_until FROM model_deployments;
ALTER VIEW reporting.model_deployment_dispatch OWNER TO platform_reporting;
