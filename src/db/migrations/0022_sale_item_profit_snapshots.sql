ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost_at_sale bigint NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS line_cost_total bigint NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS line_profit bigint NOT NULL DEFAULT 0;

WITH cost_rows AS (
  SELECT
    si.id AS sale_item_id,
    COALESCE(p.cost_price, 0)::bigint AS unit_cost
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  LEFT JOIN products p ON p.id = si.product_id AND p.location_id = s.location_id
)
UPDATE sale_items si
SET
  unit_cost_at_sale = cr.unit_cost,
  line_cost_total = ROUND(COALESCE(si.qty, 0) * cr.unit_cost)::bigint,
  line_profit = COALESCE(si.line_total, 0) - ROUND(COALESCE(si.qty, 0) * cr.unit_cost)::bigint
FROM cost_rows cr
WHERE cr.sale_item_id = si.id;
