-- Payment reversals may exceed unspent credit. Record the debt instead of dropping a valid refund event.
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS balance_nonnegative;
