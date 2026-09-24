ALTER TABLE api_keys ADD COLUMN worker_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE api_keys ADD CONSTRAINT api_key_worker_limit CHECK(cardinality(worker_ids)<=100);
CREATE INDEX queued_worker_runs ON runs(organization_id,(config->>'worker_id'),created_at,id)
 WHERE status='queued' AND config ? 'worker_id';

-- This view reveals only scheduling facts. Prompts, credentials, provider bindings and quotes stay private.
CREATE VIEW reporting.worker_placement WITH(security_barrier=true) AS
 WITH occupied AS MATERIALIZED (
   SELECT host_id,worker_id,count(*)::integer AS slots,coalesce(sum(memory_mib),0)::bigint AS memory_mib,
     coalesce(sum(cpu_millis),0)::bigint AS cpu_millis FROM host_runs WHERE released_at IS NULL GROUP BY host_id,worker_id
 ), queued AS (
   SELECT r.id,r.organization_id,(r.config->>'worker_id')::uuid AS worker_id,
     coalesce((r.config#>>'{worker_resources,memory_mib}')::integer,1024) AS memory_mib,
     coalesce((r.config#>>'{worker_resources,cpu_millis}')::integer,250) AS cpu_millis,
     coalesce((r.config#>>'{limits,timeout_seconds}')::integer,900)+180 AS window_seconds
   FROM runs r WHERE r.status='queued' AND r.kind='native_agent' AND r.config ? 'worker_id'
 ), candidates AS (
   SELECT r.*,w.desired_state,w.expires_at,w.settings,w.failure_code,
     coalesce((SELECT sum(o.slots) FROM occupied o WHERE o.worker_id=r.worker_id),0) AS occupied_slots,
     EXISTS(SELECT 1 FROM hosts h LEFT JOIN occupied o ON o.host_id=h.id
       WHERE h.worker_id=r.worker_id AND h.organization_id=r.organization_id AND h.status='ready' AND h.binding IS NOT NULL
       AND h.stopped_at IS NULL AND (h.expires_at IS NULL OR h.expires_at>=now()+r.window_seconds*interval '1 second')
       AND h.capacity>coalesce(o.slots,0)
       AND h.memory_mib-least(512,ceil(h.memory_mib::numeric/8))>=coalesce(o.memory_mib,0)+r.memory_mib
       AND h.cpu_millis>=coalesce(o.cpu_millis,0)+r.cpu_millis
       AND h.offering->>'compute'=w.settings->>'compute'
       AND (h.offering->>'dedicated')::boolean=(w.settings->>'dedicated')::boolean
       AND (NOT (w.settings->>'isolate_runs')::boolean OR (h.offering->>'isolate_runs')::boolean)
       AND h.offering->>'region'=w.settings->>'region' AND h.offering->>'runtime'=w.settings->>'runtime'
       AND (w.settings->>'size' IS NULL OR h.offering->>'size'=w.settings->>'size')) AS fits,
     EXISTS(SELECT 1 FROM hosts h WHERE h.worker_id=r.worker_id AND h.status='provisioning') AS starting
   FROM queued r LEFT JOIN workers w ON w.id=r.worker_id AND w.organization_id=r.organization_id
 ) SELECT id,organization_id,worker_id,
   (desired_state='enabled' AND (expires_at IS NULL OR expires_at>=now()+window_seconds*interval '1 second')
     AND occupied_slots<(settings->>'max_concurrency')::integer AND fits) IS TRUE AS eligible,
   CASE WHEN desired_state IS NULL OR desired_state='destroyed' THEN 'worker_destroyed'
     WHEN expires_at IS NOT NULL AND expires_at<now()+window_seconds*interval '1 second' THEN 'worker_expired'
     WHEN desired_state='paused' THEN 'worker_paused'
     WHEN occupied_slots>=(settings->>'max_concurrency')::integer THEN 'worker_concurrency'
     WHEN fits THEN NULL
     WHEN starting THEN 'worker_starting'
     WHEN failure_code IN ('worker_cost_limit','worker_instance_limit','insufficient_credits','compute_unavailable') THEN failure_code
     ELSE 'worker_capacity' END AS waiting_reason
   FROM candidates;
ALTER VIEW reporting.worker_placement OWNER TO platform_reporting;
GRANT SELECT ON reporting.worker_placement TO platform_app;
