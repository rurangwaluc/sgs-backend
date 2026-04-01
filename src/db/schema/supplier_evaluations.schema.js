"use strict";

const {
  pgTable,
  serial,
  integer,
  boolean,
  text,
  timestamp,
  index,
  uniqueIndex,
  varchar,
} = require("drizzle-orm/pg-core");

const { suppliers } = require("./suppliers.schema");

/**
 * supplier_evaluations
 *
 * Purpose:
 * - Owner-side scorecard for supplier performance
 * - One current evaluation row per supplier
 * - Keeps supplier master clean and keeps judgment fields separate
 *
 * Ratings:
 * - 1 to 5 expected at service/validator layer
 *
 * Notes:
 * - overallScore and riskLevel are stored snapshots for fast reads
 * - Backend service should recompute them whenever evaluation changes
 */

const supplierEvaluations = pgTable(
  "supplier_evaluations",
  {
    id: serial("id").primaryKey(),

    supplierId: integer("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),

    reliabilityRating: integer("reliability_rating").notNull().default(0),
    priceRating: integer("price_rating").notNull().default(0),
    qualityRating: integer("quality_rating").notNull().default(0),
    speedRating: integer("speed_rating").notNull().default(0),
    communicationRating: integer("communication_rating").notNull().default(0),

    issueCount: integer("issue_count").notNull().default(0),
    lastIssueAt: timestamp("last_issue_at", { withTimezone: true }),

    isPreferred: boolean("is_preferred").notNull().default(false),
    isWatchlist: boolean("is_watchlist").notNull().default(false),

    /**
     * Snapshot fields computed by backend service
     * Example:
     * - overallScore: 0..500 if stored as scaled integer
     *   or 0..100 depending on your service choice
     * Keep integer for simple sorting/filtering.
     */
    overallScore: integer("overall_score").notNull().default(0),

    /**
     * LOW | MEDIUM | HIGH
     */
    riskLevel: varchar("risk_level", { length: 16 })
      .notNull()
      .default("MEDIUM"),

    ownerAssessmentNote: text("owner_assessment_note"),

    evaluatedByUserId: integer("evaluated_by_user_id"),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    supplierEvaluationsSupplierIdUq: uniqueIndex(
      "supplier_evaluations_supplier_id_uq",
    ).on(t.supplierId),

    supplierEvaluationsRiskLevelIdx: index(
      "supplier_evaluations_risk_level_idx",
    ).on(t.riskLevel),

    supplierEvaluationsOverallScoreIdx: index(
      "supplier_evaluations_overall_score_idx",
    ).on(t.overallScore),

    supplierEvaluationsPreferredIdx: index(
      "supplier_evaluations_preferred_idx",
    ).on(t.isPreferred),

    supplierEvaluationsWatchlistIdx: index(
      "supplier_evaluations_watchlist_idx",
    ).on(t.isWatchlist),

    supplierEvaluationsEvaluatedAtIdx: index(
      "supplier_evaluations_evaluated_at_idx",
    ).on(t.evaluatedAt),
  }),
);

module.exports = { supplierEvaluations };
