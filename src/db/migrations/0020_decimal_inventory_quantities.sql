ALTER TABLE inventory_balances
ALTER COLUMN qty_on_hand TYPE numeric(14, 3)
USING qty_on_hand::numeric(14, 3);

ALTER TABLE inventory_balances
ALTER COLUMN qty_on_hand SET DEFAULT 0;

ALTER TABLE inventory_balances
ALTER COLUMN qty_on_hand SET NOT NULL;

ALTER TABLE inventory_adjustment_requests
ALTER COLUMN qty_change TYPE numeric(14, 3)
USING qty_change::numeric(14, 3);
