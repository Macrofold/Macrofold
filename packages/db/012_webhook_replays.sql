DROP INDEX webhook_event_delivery;
CREATE UNIQUE INDEX webhook_event_delivery ON deliveries(organization_id,(data->>'endpoint_id'),(data->>'event_id')) WHERE data ? 'event_id' AND NOT data ? 'replay_of';
