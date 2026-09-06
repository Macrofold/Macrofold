CREATE UNIQUE INDEX webhook_event_delivery ON deliveries(organization_id,(data->>'endpoint_id'),(data->>'event_id')) WHERE data ? 'event_id';
CREATE INDEX dispatch_ready ON dispatch_jobs(kind,available_at) WHERE state<>'done';
