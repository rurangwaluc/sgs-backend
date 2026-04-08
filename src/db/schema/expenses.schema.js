const {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  bigint,
  index,
} = require("drizzle-orm/pg-core");
const { locations } = require("./locations.schema");
const { users } = require("./users.schema");
const { cashSessions } = require("./cash_sessions.schema");

const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),

    locationId: integer("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),

    cashSessionId: integer("cash_session_id").references(
      () => cashSessions.id,
      {
        onDelete: "set null",
      },
    ),

    cashierId: integer("cashier_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),

    category: varchar("category", { length: 60 }).notNull().default("GENERAL"),
    amount: bigint("amount", { mode: "number" }).notNull(),

    // owner-grade fields (all additive + safe defaults)
    expenseDate: timestamp("expense_date", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // CASH / BANK / MOMO / CARD / OTHER
    method: varchar("method", { length: 20 }).notNull().default("CASH"),

    // POSTED / VOID
    status: varchar("status", { length: 20 }).notNull().default("POSTED"),

    payeeName: varchar("payee_name", { length: 120 }),

    // supplier invoice, receipt, bank slip, etc
    reference: varchar("reference", { length: 80 }),
    note: varchar("note", { length: 200 }),

    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedByUserId: integer("voided_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    voidReason: varchar("void_reason", { length: 200 }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    expensesLocationIdx: index("expenses_location_idx").on(t.locationId),
    expensesSessionIdx: index("expenses_cash_session_idx").on(t.cashSessionId),
    expensesCashierIdx: index("expenses_cashier_idx").on(t.cashierId),
    expensesStatusIdx: index("expenses_status_idx").on(t.status),
    expensesMethodIdx: index("expenses_method_idx").on(t.method),
    expensesDateIdx: index("expenses_expense_date_idx").on(t.expenseDate),
    expensesCategoryIdx: index("expenses_category_idx").on(t.category),
  }),
);

module.exports = { expenses };
