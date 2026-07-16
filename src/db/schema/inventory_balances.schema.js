const {
  pgTable,
  serial,
  integer,
  numeric,
  bigint,
  timestamp,
  uniqueIndex,
} = require("drizzle-orm/pg-core");

const inventoryBalances = pgTable(
  "inventory_balances",
  {
    id: serial("id").primaryKey(),
    locationId: integer("location_id").notNull(),
    productId: bigint("product_id", { mode: "number" }).notNull(),
    qtyOnHand: numeric("qty_on_hand", { precision: 14, scale: 3, mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    locationProductUniq: uniqueIndex(
      "inventory_balances_location_product_uniq",
    ).on(t.locationId, t.productId),
  }),
);

module.exports = { inventoryBalances };
