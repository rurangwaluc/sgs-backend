CREATE TABLE IF NOT EXISTS supplier_bill_items (
  id bigserial PRIMARY KEY,
  bill_id bigint NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
  product_id bigint NULL REFERENCES products(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  qty integer NOT NULL DEFAULT 1,
  unit_cost bigint NOT NULL DEFAULT 0,
  line_total bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_bill_items_bill_id_idx
ON supplier_bill_items (bill_id);

CREATE INDEX IF NOT EXISTS supplier_bill_items_product_id_idx
ON supplier_bill_items (product_id);