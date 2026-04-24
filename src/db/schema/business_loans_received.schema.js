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

const BUSINESS_LOAN_LENDER_TYPES = ["CUSTOMER", "OTHER"];
const BUSINESS_LOAN_METHODS = ["CASH", "BANK", "MOMO", "CARD", "OTHER"];
const BUSINESS_LOAN_STATUSES = ["OPEN", "PARTIALLY_REPAID", "REPAID", "VOID"];

const businessLoansReceived = pgTable(
  "business_loans_received",
  {
    id: serial("id").primaryKey(),

    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),

    lenderType: varchar("lender_type", { length: 20 })
      .notNull()
      .default("OTHER"),

    customerId: integer("customer_id").references(() => customers.id, {
      onDelete: "restrict",
    }),

    lenderName: varchar("lender_name", { length: 180 }).notNull(),
    lenderPhone: varchar("lender_phone", { length: 40 }),
    lenderEmail: varchar("lender_email", { length: 180 }),

    principalAmount: integer("principal_amount").notNull(),
    repaidAmount: integer("repaid_amount").notNull().default(0),

    currency: varchar("currency", { length: 8 }).notNull().default("RWF"),

    receiptMethod: varchar("receipt_method", { length: 20 })
      .notNull()
      .default("CASH"),

    receivedAt: timestamp("received_at", { withTimezone: true })
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
    businessLoansReceivedLocationIdx: index(
      "business_loans_received_location_idx",
    ).on(t.locationId),

    businessLoansReceivedCustomerIdx: index(
      "business_loans_received_customer_idx",
    ).on(t.customerId),

    businessLoansReceivedLenderTypeIdx: index(
      "business_loans_received_lender_type_idx",
    ).on(t.lenderType),

    businessLoansReceivedStatusIdx: index(
      "business_loans_received_status_idx",
    ).on(t.status),

    businessLoansReceivedDueDateIdx: index(
      "business_loans_received_due_date_idx",
    ).on(t.dueDate),

    businessLoansReceivedReceivedAtIdx: index(
      "business_loans_received_received_at_idx",
    ).on(t.receivedAt),

    businessLoansReceivedLocationStatusIdx: index(
      "business_loans_received_location_status_idx",
    ).on(t.locationId, t.status),
  }),
);

const businessLoanRepayments = pgTable(
  "business_loan_repayments",
  {
    id: serial("id").primaryKey(),

    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "restrict" }),

    businessLoanId: integer("business_loan_id")
      .notNull()
      .references(() => businessLoansReceived.id, { onDelete: "cascade" }),

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
    businessLoanRepaymentsLocationIdx: index(
      "business_loan_repayments_location_idx",
    ).on(t.locationId),

    businessLoanRepaymentsLoanIdx: index(
      "business_loan_repayments_loan_idx",
    ).on(t.businessLoanId),

    businessLoanRepaymentsMethodIdx: index(
      "business_loan_repayments_method_idx",
    ).on(t.method),

    businessLoanRepaymentsPaidAtIdx: index(
      "business_loan_repayments_paid_at_idx",
    ).on(t.paidAt),
  }),
);

module.exports = {
  BUSINESS_LOAN_LENDER_TYPES,
  BUSINESS_LOAN_METHODS,
  BUSINESS_LOAN_STATUSES,
  businessLoansReceived,
  businessLoanRepayments,
};
