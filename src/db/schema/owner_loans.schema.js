"use strict";

const {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  date,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");

const { locations } = require("./locations.schema");
const { customers } = require("./customers.schema");
const { users } = require("./users.schema");

const OWNER_LOAN_RECEIVER_TYPES = ["CUSTOMER", "OTHER"];
const OWNER_LOAN_METHODS = ["CASH", "BANK", "MOMO", "CARD", "OTHER"];
const OWNER_LOAN_STATUSES = ["OPEN", "PARTIALLY_REPAID", "REPAID", "VOID"];

const ownerLoans = pgTable(
  "owner_loans",
  {
    id: serial("id").primaryKey(),

    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),

    receiverType: varchar("receiver_type", { length: 20 })
      .notNull()
      .default("OTHER"),

    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "restrict",
    }),

    receiverName: varchar("receiver_name", { length: 180 }).notNull(),
    receiverPhone: varchar("receiver_phone", { length: 40 }),
    receiverEmail: varchar("receiver_email", { length: 180 }),

    principalAmount: integer("principal_amount").notNull(),
    repaidAmount: integer("repaid_amount").notNull().default(0),

    currency: varchar("currency", { length: 8 }).notNull().default("RWF"),

    disbursementMethod: varchar("disbursement_method", { length: 20 })
      .notNull()
      .default("CASH"),

    disbursedAt: timestamp("disbursed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    dueDate: date("due_date"),

    reference: varchar("reference", { length: 120 }),
    note: text("note"),

    status: varchar("status", { length: 24 }).notNull().default("OPEN"),

    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),

    voidedByUserId: integer("voided_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),

    voidReason: text("void_reason"),
    voidedAt: timestamp("voided_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerLoansLocationIdx: index("owner_loans_location_idx").on(t.locationId),
    ownerLoansCustomerIdx: index("owner_loans_customer_idx").on(t.customerId),
    ownerLoansReceiverTypeIdx: index("owner_loans_receiver_type_idx").on(
      t.receiverType,
    ),
    ownerLoansStatusIdx: index("owner_loans_status_idx").on(t.status),
    ownerLoansDueDateIdx: index("owner_loans_due_date_idx").on(t.dueDate),
    ownerLoansDisbursedAtIdx: index("owner_loans_disbursed_at_idx").on(
      t.disbursedAt,
    ),
    ownerLoansLocationStatusIdx: index("owner_loans_location_status_idx").on(
      t.locationId,
      t.status,
    ),
  }),
);

const ownerLoanRepayments = pgTable(
  "owner_loan_repayments",
  {
    id: serial("id").primaryKey(),

    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),

    ownerLoanId: integer("owner_loan_id")
      .notNull()
      .references(() => ownerLoans.id, { onDelete: "cascade" }),

    amount: integer("amount").notNull(),

    method: varchar("method", { length: 20 }).notNull().default("CASH"),

    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),

    reference: varchar("reference", { length: 120 }),
    note: varchar("note", { length: 300 }),

    createdByUserId: integer("created_by_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ownerLoanRepaymentsLocationIdx: index(
      "owner_loan_repayments_location_idx",
    ).on(t.locationId),
    ownerLoanRepaymentsLoanIdx: index("owner_loan_repayments_loan_idx").on(
      t.ownerLoanId,
    ),
    ownerLoanRepaymentsMethodIdx: index("owner_loan_repayments_method_idx").on(
      t.method,
    ),
    ownerLoanRepaymentsPaidAtIdx: index("owner_loan_repayments_paid_at_idx").on(
      t.paidAt,
    ),
  }),
);

module.exports = {
  OWNER_LOAN_RECEIVER_TYPES,
  OWNER_LOAN_METHODS,
  OWNER_LOAN_STATUSES,
  ownerLoans,
  ownerLoanRepayments,
};
