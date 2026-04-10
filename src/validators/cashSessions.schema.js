const { z } = require("zod");

const openCashSessionSchema = z.object({
  openingBalance: z.number().int().min(0).default(0),
  openingVarianceReason: z.string().trim().max(300).optional(),
});

const closeCashSessionSchema = z.object({
  countedCash: z.number().int().min(0),
  closingVarianceReason: z.string().trim().max(300).optional(),
  note: z.string().trim().max(200).optional(),
});

module.exports = { openCashSessionSchema, closeCashSessionSchema };
