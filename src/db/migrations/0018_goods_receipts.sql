CREATE TABLE IF NOT EXISTS goods_receipts (
  id bigserial PRIMARY KEY,
  location_id bigint NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  purchase_order_id bigint NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id bigint NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  receipt_no text NOT NULL DEFAULT '',
  reference text NULL,
  note text NULL,
  received_by_user_id bigint NULL REFERENCES users(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  total_lines integer NOT NULL DEFAULT 0,
  total_units_received bigint NOT NULL DEFAULT 0,
  total_amount bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS goods_receipts_location_id_idx
ON goods_receipts (location_id);

CREATE INDEX IF NOT EXISTS goods_receipts_purchase_order_id_idx
ON goods_receipts (purchase_order_id);

CREATE INDEX IF NOT EXISTS goods_receipts_supplier_id_idx
ON goods_receipts (supplier_id);

CREATE INDEX IF NOT EXISTS goods_receipts_received_at_idx
ON goods_receipts (received_at);