ALTER TABLE "expenses"
  ADD COLUMN "expense_date" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN "method" varchar(20) DEFAULT 'CASH' NOT NULL,
  ADD COLUMN "status" varchar(20) DEFAULT 'POSTED' NOT NULL,
  ADD COLUMN "payee_name" varchar(120),
  ADD COLUMN "voided_at" timestamp with time zone,
  ADD COLUMN "voided_by_user_id" integer,
  ADD COLUMN "void_reason" varchar(200);
--> statement-breakpoint
ALTER TABLE "cash_ledger"
  ADD COLUMN "expense_id" integer;
--> statement-breakpoint
CREATE TABLE "expense_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "expense_id" integer NOT NULL,
  "file_url" text NOT NULL,
  "original_name" varchar(255),
  "content_type" varchar(120),
  "file_size" bigint,
  "uploaded_by_user_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_voided_by_user_id_users_id_fk"
  FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cash_ledger"
  ADD CONSTRAINT "cash_ledger_expense_id_expenses_id_fk"
  FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_attachments"
  ADD CONSTRAINT "expense_attachments_expense_id_expenses_id_fk"
  FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expense_attachments"
  ADD CONSTRAINT "expense_attachments_uploaded_by_user_id_users_id_fk"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "expenses_location_idx" ON "expenses" USING btree ("location_id");
CREATE INDEX "expenses_cash_session_idx" ON "expenses" USING btree ("cash_session_id");
CREATE INDEX "expenses_cashier_idx" ON "expenses" USING btree ("cashier_id");
CREATE INDEX "expenses_status_idx" ON "expenses" USING btree ("status");
CREATE INDEX "expenses_method_idx" ON "expenses" USING btree ("method");
CREATE INDEX "expenses_expense_date_idx" ON "expenses" USING btree ("expense_date");
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category");
CREATE INDEX "cash_ledger_location_idx" ON "cash_ledger" USING btree ("location_id");
CREATE INDEX "cash_ledger_cashier_idx" ON "cash_ledger" USING btree ("cashier_id");
CREATE INDEX "cash_ledger_session_idx" ON "cash_ledger" USING btree ("cash_session_id");
CREATE INDEX "cash_ledger_type_idx" ON "cash_ledger" USING btree ("type");
CREATE INDEX "cash_ledger_method_idx" ON "cash_ledger" USING btree ("method");
CREATE INDEX "cash_ledger_expense_idx" ON "cash_ledger" USING btree ("expense_id");
CREATE INDEX "cash_ledger_created_at_idx" ON "cash_ledger" USING btree ("created_at");
CREATE INDEX "expense_attachments_expense_idx" ON "expense_attachments" USING btree ("expense_id");
CREATE INDEX "expense_attachments_uploader_idx" ON "expense_attachments" USING btree ("uploaded_by_user_id");
