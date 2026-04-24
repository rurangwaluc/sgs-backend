CREATE TABLE IF NOT EXISTS "business_loans_received" (
  "id" serial PRIMARY KEY NOT NULL,
  "location_id" integer NOT NULL,
  "lender_type" varchar(20) NOT NULL DEFAULT 'OTHER',
  "customer_id" integer,
  "lender_name" varchar(180) NOT NULL,
  "lender_phone" varchar(40),
  "lender_email" varchar(180),
  "principal_amount" integer NOT NULL,
  "repaid_amount" integer NOT NULL DEFAULT 0,
  "currency" varchar(8) NOT NULL DEFAULT 'RWF',
  "receipt_method" varchar(20) NOT NULL DEFAULT 'CASH',
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "due_date" date,
  "reference" varchar(120),
  "note" text,
  "status" varchar(24) NOT NULL DEFAULT 'OPEN',
  "created_by_user_id" integer,
  "voided_by_user_id" integer,
  "void_reason" text,
  "voided_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "business_loan_repayments" (
  "id" serial PRIMARY KEY NOT NULL,
  "location_id" integer NOT NULL,
  "business_loan_id" integer NOT NULL,
  "amount" integer NOT NULL,
  "method" varchar(20) NOT NULL DEFAULT 'CASH',
  "paid_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reference" varchar(120),
  "note" varchar(300),
  "created_by_user_id" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

ALTER TABLE "cash_ledger"
  ADD COLUMN IF NOT EXISTS "business_loan_received_id" integer,
  ADD COLUMN IF NOT EXISTS "business_loan_repayment_id" integer;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_loans_received_location_id_locations_id_fk'
  ) THEN
    ALTER TABLE "business_loans_received"
      ADD CONSTRAINT "business_loans_received_location_id_locations_id_fk"
      FOREIGN KEY ("location_id")
      REFERENCES "locations"("id")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_loans_received_customer_id_customers_id_fk'
  ) THEN
    ALTER TABLE "business_loans_received"
      ADD CONSTRAINT "business_loans_received_customer_id_customers_id_fk"
      FOREIGN KEY ("customer_id")
      REFERENCES "customers"("id")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_loans_received_created_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "business_loans_received"
      ADD CONSTRAINT "business_loans_received_created_by_user_id_users_id_fk"
      FOREIGN KEY ("created_by_user_id")
      REFERENCES "users"("id")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_loans_received_voided_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "business_loans_received"
      ADD CONSTRAINT "business_loans_received_voided_by_user_id_users_id_fk"
      FOREIGN KEY ("voided_by_user_id")
      REFERENCES "users"("id")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_loan_repayments_location_id_locations_id_fk'
  ) THEN
    ALTER TABLE "business_loan_repayments"
      ADD CONSTRAINT "business_loan_repayments_location_id_locations_id_fk"
      FOREIGN KEY ("location_id")
      REFERENCES "locations"("id")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_loan_repayments_business_loan_id_business_loans_received_id_fk'
  ) THEN
    ALTER TABLE "business_loan_repayments"
      ADD CONSTRAINT "business_loan_repayments_business_loan_id_business_loans_received_id_fk"
      FOREIGN KEY ("business_loan_id")
      REFERENCES "business_loans_received"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_loan_repayments_created_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "business_loan_repayments"
      ADD CONSTRAINT "business_loan_repayments_created_by_user_id_users_id_fk"
      FOREIGN KEY ("created_by_user_id")
      REFERENCES "users"("id")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_ledger_business_loan_received_id_business_loans_received_id_fk'
  ) THEN
    ALTER TABLE "cash_ledger"
      ADD CONSTRAINT "cash_ledger_business_loan_received_id_business_loans_received_id_fk"
      FOREIGN KEY ("business_loan_received_id")
      REFERENCES "business_loans_received"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_ledger_business_loan_repayment_id_business_loan_repayments_id_fk'
  ) THEN
    ALTER TABLE "cash_ledger"
      ADD CONSTRAINT "cash_ledger_business_loan_repayment_id_business_loan_repayments_id_fk"
      FOREIGN KEY ("business_loan_repayment_id")
      REFERENCES "business_loan_repayments"("id")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "business_loans_received_location_idx"
  ON "business_loans_received" USING btree ("location_id");

CREATE INDEX IF NOT EXISTS "business_loans_received_customer_idx"
  ON "business_loans_received" USING btree ("customer_id");

CREATE INDEX IF NOT EXISTS "business_loans_received_lender_type_idx"
  ON "business_loans_received" USING btree ("lender_type");

CREATE INDEX IF NOT EXISTS "business_loans_received_status_idx"
  ON "business_loans_received" USING btree ("status");

CREATE INDEX IF NOT EXISTS "business_loans_received_due_date_idx"
  ON "business_loans_received" USING btree ("due_date");

CREATE INDEX IF NOT EXISTS "business_loans_received_received_at_idx"
  ON "business_loans_received" USING btree ("received_at");

CREATE INDEX IF NOT EXISTS "business_loans_received_location_status_idx"
  ON "business_loans_received" USING btree ("location_id", "status");

CREATE INDEX IF NOT EXISTS "business_loan_repayments_location_idx"
  ON "business_loan_repayments" USING btree ("location_id");

CREATE INDEX IF NOT EXISTS "business_loan_repayments_loan_idx"
  ON "business_loan_repayments" USING btree ("business_loan_id");

CREATE INDEX IF NOT EXISTS "business_loan_repayments_method_idx"
  ON "business_loan_repayments" USING btree ("method");

CREATE INDEX IF NOT EXISTS "business_loan_repayments_paid_at_idx"
  ON "business_loan_repayments" USING btree ("paid_at");

CREATE INDEX IF NOT EXISTS "cash_ledger_business_loan_received_idx"
  ON "cash_ledger" USING btree ("business_loan_received_id");

CREATE INDEX IF NOT EXISTS "cash_ledger_business_loan_repayment_idx"
  ON "cash_ledger" USING btree ("business_loan_repayment_id");