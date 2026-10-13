-- The scheduling view needs job state, not diagnostic text.
GRANT SELECT(kind,resource_id,state) ON dispatch_jobs TO platform_reporting;
CREATE POLICY reporting_read ON dispatch_jobs FOR SELECT TO platform_reporting USING(true);
