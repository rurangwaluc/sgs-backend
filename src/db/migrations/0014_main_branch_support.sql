ALTER TABLE locations
ADD COLUMN IF NOT EXISTS is_main boolean NOT NULL DEFAULT false;

-- Backfill: make the first existing ACTIVE branch the main one.
WITH first_active AS (
  SELECT id
  FROM locations
  WHERE status = 'ACTIVE'
  ORDER BY id ASC
  LIMIT 1
)
UPDATE locations
SET is_main = CASE
  WHEN id = (SELECT id FROM first_active) THEN true
  ELSE false
END;

-- Safety: at most one main branch in the whole system.
CREATE UNIQUE INDEX IF NOT EXISTS locations_single_main_branch_uq
ON locations ((1))
WHERE is_main = true;

CREATE INDEX IF NOT EXISTS locations_is_main_idx
ON locations (is_main);