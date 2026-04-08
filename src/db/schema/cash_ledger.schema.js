const {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  text,
  index,
} = require("drizzle-orm/pg-core");
const { expenses } = require("./expenses.schema");

const cashLedger = pgTable(
  "cash_ledger",
  {
    id: serial("id").primaryKey(),

    locationId: integer("location_id").notNull(),
    cashierId: integer("cashier_id").notNull(),

    // optional link to open cashier session
    cashSessionId: integer("cash_session_id"),

    // SALE_PAYMENT, CREDIT_PAYMENT, PETTY_CASH_IN, PETTY_CASH_OUT, VERSEMENT, OPENING_BALANCE, REFUND, etc
    type: varchar("type", { length: 40 }).notNull(),

    // IN / OUT
    direction: varchar("direction", { length: 10 }).notNull(),

    amount: integer("amount").notNull(),

    // CASH / MOMO / CARD / BANK / OTHER
    method: varchar("method", { length: 20 }).notNull().default("CASH"),

    // optional external reference (MoMo TXN ID, bank ref, etc)
    reference: varchar("reference", { length: 120 }),

    saleId: integer("sale_id"),
    paymentId: integer("payment_id"),

    // owner expense linkage (phase 1: schema only)
    expenseId: integer("expense_id").references(() => expenses.id, {
      onDelete: "set null",
    }),

    // ✅ new for credit collection traceability
    creditId: integer("credit_id"),
    creditPaymentId: integer("credit_payment_id"),

    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    cashLedgerLocationIdx: index("cash_ledger_location_idx").on(t.locationId),
    cashLedgerCashierIdx: index("cash_ledger_cashier_idx").on(t.cashierId),
    cashLedgerSessionIdx: index("cash_ledger_session_idx").on(t.cashSessionId),
    cashLedgerTypeIdx: index("cash_ledger_type_idx").on(t.type),
    cashLedgerMethodIdx: index("cash_ledger_method_idx").on(t.method),
    cashLedgerExpenseIdx: index("cash_ledger_expense_idx").on(t.expenseId),
    cashLedgerCreatedAtIdx: index("cash_ledger_created_at_idx").on(t.createdAt),
  }),
);

module.exports = { cashLedger };
