ALTER TABLE "credit_payments"
  ADD COLUMN IF NOT EXISTS "installment_id" integer;

CREATE INDEX IF NOT EXISTS "credit_payments_installment_idx"
  ON "credit_payments" ("installment_id");

CREATE INDEX IF NOT EXISTS "credit_payments_credit_idx"
  ON "credit_payments" ("credit_id");
