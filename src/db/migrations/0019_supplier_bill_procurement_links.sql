ALTER TABLE supplier_bills
ADD COLUMN IF NOT EXISTS purchase_order_id bigint NULL REFERENCES purchase_orders(id) ON DELETE SET NULL;

ALTER TABLE supplier_bills
ADD COLUMN IF NOT EXISTS goods_receipt_id bigint NULL REFERENCES goods_receipts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS supplier_bills_purchase_order_id_idx
ON supplier_bills (purchase_order_id);

CREATE INDEX IF NOT EXISTS supplier_bills_goods_receipt_id_idx
ON supplier_bills (goods_receipt_id);