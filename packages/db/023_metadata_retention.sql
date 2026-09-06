-- Retention sweeps are bounded and do not remove accounting or durable run identities.
CREATE INDEX product_events_retention ON product_events(created_at);
CREATE FUNCTION immutable_operator_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Operator access audit rows are immutable'; END $$;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON admin_audit
FOR EACH ROW EXECUTE FUNCTION immutable_operator_audit();
