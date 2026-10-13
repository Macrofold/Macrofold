-- Failure budgets are separate from delivery attempts, which fence external effects.
ALTER TABLE dispatch_jobs ADD COLUMN failure_attempts integer NOT NULL DEFAULT 0 CHECK(failure_attempts>=0);
ALTER TABLE dispatch_jobs ADD COLUMN expires_at timestamptz;
ALTER TABLE hosts ADD COLUMN failure_attempts integer NOT NULL DEFAULT 0 CHECK(failure_attempts>=0);
ALTER TABLE hosts ADD COLUMN retry_exhausted_at timestamptz;
ALTER TABLE hosts ADD COLUMN drain_started_at timestamptz;
ALTER TABLE workers ADD COLUMN failure_attempts integer NOT NULL DEFAULT 0 CHECK(failure_attempts>=0);
CREATE OR REPLACE VIEW reporting.worker_schedule WITH(security_barrier=true) AS
 SELECT w.id,w.organization_id,w.next_check_at FROM workers w
 WHERE w.failure_attempts<8 AND (
 EXISTS(SELECT 1 FROM hosts h WHERE h.worker_id=w.id AND h.status<>'stopped' AND h.retry_exhausted_at IS NULL)
 OR (w.desired_state='enabled' AND w.failure_code IS DISTINCT FROM 'worker_retry_exhausted'
   AND (w.expires_at IS NULL OR w.expires_at>now()) AND
   ((w.settings->>'min_instances')::integer>0 OR EXISTS(
     SELECT 1 FROM runs r WHERE r.organization_id=w.organization_id AND r.config->>'worker_id'=w.id::text
       AND r.status='queued' AND NOT r.cancel_requested AND r.queue_expires_at>now()
       AND NOT EXISTS(SELECT 1 FROM dispatch_jobs j WHERE j.kind='run' AND j.resource_id=r.id AND j.state='blocked')))));
ALTER VIEW reporting.worker_schedule OWNER TO platform_reporting;

-- Scheduler hints must agree with the authoritative allocation gate.
CREATE OR REPLACE VIEW reporting.worker_placement WITH(security_barrier=true) AS
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
       AND h.funded_until>=now()+(r.window_seconds+60)*interval '1 second'
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
   (desired_state='enabled' AND failure_code IS DISTINCT FROM 'worker_retry_exhausted' AND (expires_at IS NULL OR expires_at>=now()+window_seconds*interval '1 second')
     AND occupied_slots<(settings->>'max_concurrency')::integer AND fits) IS TRUE AS eligible,
   CASE WHEN desired_state IS NULL OR desired_state='destroyed' THEN 'worker_destroyed'
     WHEN expires_at IS NOT NULL AND expires_at<=now() THEN 'worker_expired'
     WHEN expires_at IS NOT NULL AND expires_at<now()+window_seconds*interval '1 second' THEN 'worker_lifetime'
     WHEN desired_state='paused' THEN 'worker_paused'
     WHEN failure_code='worker_retry_exhausted' THEN failure_code
     WHEN occupied_slots>=(settings->>'max_concurrency')::integer THEN 'worker_concurrency'
     WHEN fits THEN NULL
     WHEN starting THEN 'worker_starting'
     WHEN failure_code IN ('worker_cost_limit','worker_instance_limit','insufficient_credits','compute_unavailable') THEN failure_code
     ELSE 'worker_capacity' END AS waiting_reason
   FROM candidates;
ALTER VIEW reporting.worker_placement OWNER TO platform_reporting;
