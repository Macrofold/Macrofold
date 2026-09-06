CREATE OR REPLACE VIEW reporting.runs WITH (security_barrier=true) AS
SELECT id,organization_id,project_id,workspace_id,status,created_at,started_at,completed_at,heartbeat_at,deadline,cost_micro_usd,
config->>'harness' AS harness,config->>'model' AS model,result->>'failure_code' AS failure_code,result->>'persistence_status' AS persistence_status,
config->>'billing_mode' AS billing_mode,config->'rate_card'->>'provider' AS provider
FROM public.runs;
