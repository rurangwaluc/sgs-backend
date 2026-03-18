ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "acting_as_role" varchar(50),
  ADD COLUMN IF NOT EXISTS "coverage_reason" varchar(50),
  ADD COLUMN IF NOT EXISTS "coverage_note" text,
  ADD COLUMN IF NOT EXISTS "coverage_started_at" timestamp;