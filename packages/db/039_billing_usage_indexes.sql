-- Bounded billing pages use tenant/time ranges; finalized compute reconciles
-- model/tool facts by run. No new financial or diagnostic storage is introduced.
CREATE INDEX model_usage_tenant_time ON model_usage(organization_id,created_at,id);
CREATE INDEX model_usage_run ON model_usage(run_id);
CREATE INDEX tool_invocations_tenant_time ON tool_invocations(organization_id,created_at,id);
CREATE INDEX gateway_requests_run ON gateway_requests(run_id);
CREATE INDEX ledger_consumption_tenant_time ON ledger(organization_id,created_at,id) WHERE account='consumption';
