"use strict";

const { z } = require("zod");

function ratingField(label) {
  return z.coerce
    .number()
    .int()
    .min(1, `${label} must be at least 1`)
    .max(5, `${label} must be at most 5`);
}

function optionalTrimmedString(max) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => {
      if (v == null) return undefined;
      const s = String(v).trim();
      return s || undefined;
    });
}

const riskLevelEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);

const supplierEvaluationCreateSchema = z.object({
  supplierId: z.coerce.number().int().positive(),

  reliabilityRating: ratingField("reliabilityRating"),
  priceRating: ratingField("priceRating"),
  qualityRating: ratingField("qualityRating"),
  speedRating: ratingField("speedRating"),
  communicationRating: ratingField("communicationRating"),

  issueCount: z.coerce.number().int().min(0).max(100000).optional().default(0),
  lastIssueAt: z.string().trim().optional(),

  isPreferred: z.coerce.boolean().optional().default(false),
  isWatchlist: z.coerce.boolean().optional().default(false),

  /**
   * These may be recomputed by service layer.
   * Allowed in payload so owner-side APIs can pass them through if desired,
   * but backend should still treat service computation as source of truth.
   */
  overallScore: z.coerce.number().int().min(0).max(1000).optional(),
  riskLevel: riskLevelEnum.optional(),

  ownerAssessmentNote: optionalTrimmedString(4000),

  evaluatedByUserId: z.coerce.number().int().positive().optional(),
  evaluatedAt: z.string().trim().optional(),
});

const supplierEvaluationUpdateBaseSchema = z.object({
  reliabilityRating: ratingField("reliabilityRating").optional(),
  priceRating: ratingField("priceRating").optional(),
  qualityRating: ratingField("qualityRating").optional(),
  speedRating: ratingField("speedRating").optional(),
  communicationRating: ratingField("communicationRating").optional(),

  issueCount: z.coerce.number().int().min(0).max(100000).optional(),
  lastIssueAt: z.string().trim().optional(),

  isPreferred: z.coerce.boolean().optional(),
  isWatchlist: z.coerce.boolean().optional(),

  overallScore: z.coerce.number().int().min(0).max(1000).optional(),
  riskLevel: riskLevelEnum.optional(),

  ownerAssessmentNote: optionalTrimmedString(4000),

  evaluatedByUserId: z.coerce.number().int().positive().optional(),
  evaluatedAt: z.string().trim().optional(),
});

const supplierEvaluationUpdateSchema =
  supplierEvaluationUpdateBaseSchema.refine(
    (data) => Object.keys(data || {}).length > 0,
    "Provide at least one field to update",
  );

module.exports = {
  supplierEvaluationCreateSchema,
  supplierEvaluationUpdateSchema,
};
