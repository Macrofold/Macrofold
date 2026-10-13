-- Durable spending fence, independent of native process and settlement recovery.
ALTER TABLE runs ADD COLUMN model_error_request_id uuid;
