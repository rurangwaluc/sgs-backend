"use strict";

const { z } = require("zod");

const updateProductPricingSchema = z.object({
  purchasePrice: z.coerce.number().int().min(0),

  sellingPrice: z.coerce.number().int().positive(),

  maxDiscountPercent: z.coerce.number().int().min(0).max(100).default(0),

  maxDiscountAmount: z.coerce.number().int().min(0).default(0),
  correctionReason: z.string().trim().min(3).max(500).optional(),
});

module.exports = { updateProductPricingSchema };
