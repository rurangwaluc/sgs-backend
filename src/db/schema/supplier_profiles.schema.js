"use strict";

const {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
  bigint,
} = require("drizzle-orm/pg-core");

const { suppliers } = require("./suppliers.schema");

/**
 * supplier_profiles
 *
 * Purpose:
 * - Extends the supplier master with operational payment/setup data
 * - One profile per supplier
 * - Stores preferred/accepted payment methods and payout instructions
 *
 * Notes:
 * - Keep actual bill payment records in supplier_bill_payments
 * - This table stores supplier-level preference/configuration only
 * - acceptedPaymentMethods is stored as a delimited text for now
 *   to avoid schema complexity during this lock phase
 */

const supplierProfiles = pgTable(
  "supplier_profiles",
  {
    id: serial("id").primaryKey(),

    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),

    /**
     * Main preferred method for this supplier
     * CASH | MOMO | CARD | BANK | OTHER
     */
    preferredPaymentMethod: varchar("preferred_payment_method", {
      length: 20,
    })
      .notNull()
      .default("BANK"),

    /**
     * Comma-separated allowed methods, example:
     * "BANK,MOMO"
     * "CASH,BANK,CARD"
     */
    acceptedPaymentMethods: text("accepted_payment_methods"),

    /**
     * Payment terms
     * Examples:
     * - IMMEDIATE
     * - 7_DAYS
     * - 15_DAYS
     * - 30_DAYS
     * - CUSTOM
     */
    paymentTermsLabel: varchar("payment_terms_label", { length: 20 })
      .notNull()
      .default("IMMEDIATE"),

    /**
     * Numeric payment terms helper
     * Example:
     * - IMMEDIATE => 0
     * - 30_DAYS => 30
     * - CUSTOM => any positive integer
     */
    paymentTermsDays: integer("payment_terms_days").notNull().default(0),

    /**
     * Optional supplier credit guidance / working cap
     * Stored as integer money amount
     */
    creditLimit: bigint("credit_limit", { mode: "number" })
      .notNull()
      .default(0),

    /**
     * Bank payout details
     */
    bankName: varchar("bank_name", { length: 160 }),
    bankAccountName: varchar("bank_account_name", { length: 180 }),
    bankAccountNumber: varchar("bank_account_number", { length: 80 }),
    bankBranch: varchar("bank_branch", { length: 160 }),

    /**
     * Mobile money payout details
     */
    momoName: varchar("momo_name", { length: 180 }),
    momoPhone: varchar("momo_phone", { length: 40 }),

    /**
     * Tax / invoicing support
     */
    taxId: varchar("tax_id", { length: 80 }),

    /**
     * Free-form operational payment instructions
     * Example:
     * "Always send proof of transfer on WhatsApp"
     */
    paymentInstructions: text("payment_instructions"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    supplierProfilesSupplierIdUq: uniqueIndex(
      "supplier_profiles_supplier_id_uq",
    ).on(t.supplierId),

    supplierProfilesPreferredMethodIdx: index(
      "supplier_profiles_preferred_method_idx",
    ).on(t.preferredPaymentMethod),

    supplierProfilesTermsLabelIdx: index(
      "supplier_profiles_terms_label_idx",
    ).on(t.paymentTermsLabel),

    supplierProfilesTermsDaysIdx: index("supplier_profiles_terms_days_idx").on(
      t.paymentTermsDays,
    ),
  }),
);

module.exports = { supplierProfiles };
