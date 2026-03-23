const {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  text,
} = require("drizzle-orm/pg-core");

const stockRequests = pgTable("stock_requests", {
  id: serial("id").primaryKey(),
  locationId: integer("location_id").notNull(),
  sellerId: integer("seller_id").notNull(),

  status: varchar("status", { length: 30 }).notNull().default("PENDING"), // PENDING, APPROVED, REJECTED, RELEASED, CANCELED

  note: text("note"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),

  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedBy: integer("approved_by"),

  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectedBy: integer("rejected_by"),

  releasedAt: timestamp("released_at", { withTimezone: true }),
  releasedBy: integer("released_by"),
});

module.exports = { stockRequests };
