-- Retain the definitive metering boundary across lost shutdown acknowledgements.
ALTER TABLE hosts ADD COLUMN usage_finalized_at timestamptz;
