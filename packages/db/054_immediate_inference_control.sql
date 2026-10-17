-- Receipt time is trusted control-plane evidence, never a backfilled provider
-- timestamp. Existing invocations deliberately retain NULL.
ALTER TABLE decision_invocations ADD COLUMN provider_completed_at timestamptz;

GRANT USAGE ON SCHEMA auth TO platform_reporting;
GRANT SELECT(id,"emailVerified") ON auth."user" TO platform_reporting;
GRANT SELECT(id,organization_id,user_id,revoked_at,expires_at,scopes,workspace_ids)
 ON api_keys TO platform_reporting;

-- A fixed projection may observe already-admitted cross-tenant Run identities;
-- it exposes no key IDs/hashes, credentials, user content, or configuration.
CREATE VIEW reporting.inference_control WITH(security_barrier=true) AS
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
 WHERE r.kind='inference' AND r.config->>'principal_kind'='api_key';
ALTER VIEW reporting.inference_control OWNER TO platform_reporting;
