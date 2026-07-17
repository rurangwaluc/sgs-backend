ALTER TABLE sale_items
  ALTER COLUMN qty TYPE numeric(14,3)
  USING qty::numeric(14,3);

ALTER TABLE sale_items
  ALTER COLUMN qty SET DEFAULT 0;
