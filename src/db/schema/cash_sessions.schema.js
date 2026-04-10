const {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  bigint,
} = require("drizzle-orm/pg-core");
const { locations } = require("./locations.schema");
const { users } = require("./users.schema");

const cashSessions = pgTable("cash_sessions", {
  id: serial("id").primaryKey(),

  locationId: integer("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),

  cashierId: integer("cashier_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),

  status: varchar("status", { length: 20 }).notNull().default("OPEN"), // OPEN | CLOSED

  openedAt: timestamp("opened_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),

  openingBalance: bigint("opening_balance", { mode: "number" })
    .notNull()
    .default(0),
  closingBalance: bigint("closing_balance", { mode: "number" })
    .notNull()
    .default(0),

  expectedOpeningBalance: bigint("expected_opening_balance", { mode: "number" })
    .notNull()
    .default(0),

  openingVarianceAmount: bigint("opening_variance_amount", { mode: "number" })
    .notNull()
    .default(0),

  openingVarianceType: varchar("opening_variance_type", { length: 20 })
    .notNull()
    .default("MATCH"), // MATCH | SHORTAGE | SURPLUS

  openingVarianceReason: varchar("opening_variance_reason", { length: 300 }),

  previousSessionId: integer("previous_session_id"),

  expectedClosingBalance: bigint("expected_closing_balance", { mode: "number" })
    .notNull()
    .default(0),

  countedClosingBalance: bigint("counted_closing_balance", { mode: "number" })
    .notNull()
    .default(0),

  closingVarianceAmount: bigint("closing_variance_amount", { mode: "number" })
    .notNull()
    .default(0),

  closingVarianceType: varchar("closing_variance_type", { length: 20 })
    .notNull()
    .default("MATCH"),

  closingVarianceReason: varchar("closing_variance_reason", { length: 300 }),

  closingNote: varchar("closing_note", { length: 200 }),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

module.exports = { cashSessions };
