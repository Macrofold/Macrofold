-- Managed PostgreSQL owners are not necessarily superusers. FORCE RLS must not
-- silently turn global operator reports into empty reports in production.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='platform_reporting') THEN
   CREATE ROLE platform_reporting NOLOGIN NOBYPASSRLS;
 END IF;
 EXECUTE format('GRANT platform_reporting TO %I', current_user);
END $$;
GRANT USAGE ON SCHEMA public,reporting TO platform_reporting;
-- A non-superuser owner can transfer a view only when its new owner can CREATE
-- in the schema. The migration runner removes this temporary privilege afterward.
GRANT CREATE ON SCHEMA reporting TO platform_reporting;
GRANT SELECT ON runs,model_usage,actor_activity,organizations,memberships,api_requests TO platform_reporting;
CREATE POLICY reporting_read ON runs FOR SELECT TO platform_reporting USING (true);
CREATE POLICY reporting_read ON model_usage FOR SELECT TO platform_reporting USING (true);
CREATE POLICY reporting_read ON actor_activity FOR SELECT TO platform_reporting USING (true);
ALTER VIEW reporting.runs OWNER TO platform_reporting;
ALTER VIEW reporting.usage OWNER TO platform_reporting;
ALTER VIEW reporting.activity OWNER TO platform_reporting;
ALTER VIEW reporting.accounts OWNER TO platform_reporting;
ALTER VIEW reporting.requests OWNER TO platform_reporting;
