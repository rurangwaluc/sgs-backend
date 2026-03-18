DO $$ BEGIN
  CREATE TYPE "public"."location_status" AS ENUM('ACTIVE', 'CLOSED', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "locations"
  ADD COLUMN IF NOT EXISTS "code" varchar(40),
  ADD COLUMN IF NOT EXISTS "status" "location_status" DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "email" varchar(160),
  ADD COLUMN IF NOT EXISTS "address" varchar(255),
  ADD COLUMN IF NOT EXISTS "tin" varchar(64),
  ADD COLUMN IF NOT EXISTS "momo_code" varchar(64),
  ADD COLUMN IF NOT EXISTS "bank_accounts" jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "opened_at" timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "close_reason" varchar(500),
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now();

UPDATE "locations"
SET
  "code" = UPPER(REGEXP_REPLACE(COALESCE("name", 'LOC'), '[^A-Za-z0-9]+', '_', 'g')),
  "status" = COALESCE("status", 'ACTIVE'::"location_status"),
  "bank_accounts" = COALESCE("bank_accounts", '[]'::jsonb),
  "opened_at" = COALESCE("opened_at", now()),
  "updated_at" = COALESCE("updated_at", now())
WHERE
  "code" IS NULL
  OR "status" IS NULL
  OR "bank_accounts" IS NULL
  OR "opened_at" IS NULL
  OR "updated_at" IS NULL;

ALTER TABLE "locations"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "bank_accounts" SET NOT NULL,
  ALTER COLUMN "opened_at" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "locations_code_uniq" ON "locations" ("code");
CREATE INDEX IF NOT EXISTS "locations_status_idx" ON "locations" ("status");