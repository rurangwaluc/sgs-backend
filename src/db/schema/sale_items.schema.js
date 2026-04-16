// backend/src/db/schema/sale_items.schema.js
const {
  pgTable,
  serial,
  integer,
  bigint,
  varchar,
  text,
  timestamp,
} = require("drizzle-orm/pg-core");

const saleItems = pgTable("sale_items", {
  id: serial("id").primaryKey(),

  saleId: integer("sale_id").notNull(),

  productId: bigint("product_id", { mode: "number" }).notNull(),

  qty: integer("qty").notNull(),

  /**
   * Official system price at the moment seller created the sale.
   * This preserves manager-set pricing truth.
   */
  baseUnitPrice: bigint("base_unit_price", { mode: "number" })
    .notNull()
    .default(0),

  /**
   * Seller-added extra amount per unit above the official system price.
   * 0 means no uplift.
   */
  extraChargePerUnit: bigint("extra_charge_per_unit", { mode: "number" })
    .notNull()
    .default(0),

  /**
   * Final unit price used for this sale line.
   * finalUnitPrice = baseUnitPrice + extraChargePerUnit
   */
  unitPrice: bigint("unit_price", { mode: "number" }).notNull(),

  lineTotal: bigint("line_total", { mode: "number" }).notNull(),

  /**
   * Optional seller explanation for why price was increased.
   * Example: "customer accepted premium walk-in price"
   */
  priceAdjustmentReason: text("price_adjustment_reason"),

  /**
   * Simple audit classification.
   * NONE = no uplift
   * SELLER_UPLIFT = seller added approved extra charge
   */
  priceAdjustmentType: varchar("price_adjustment_type", { length: 30 })
    .notNull()
    .default("NONE"),

  /**
   * Who applied the uplift.
   * For phase 1 this will normally be the seller creating the sale.
   */
  priceAdjustedByUserId: integer("price_adjusted_by_user_id"),

  /**
   * When uplift was applied.
   */
  priceAdjustedAt: timestamp("price_adjusted_at", { withTimezone: true }),
});

module.exports = { saleItems };
