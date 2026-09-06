ALTER TABLE billing_orders DROP CONSTRAINT billing_orders_kind_check;
UPDATE billing_orders SET kind='subscription' WHERE kind='pro';
ALTER TABLE billing_orders ADD CONSTRAINT billing_orders_kind_check CHECK(kind IN('topup','subscription'));
