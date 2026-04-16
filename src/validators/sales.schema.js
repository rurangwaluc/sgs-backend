const { z } = require("zod");

/**
 * Option B (NO holdings):
 * - Seller creates sale as DRAFT
 * - Storekeeper fulfills sale -> deduct inventory -> status becomes FULFILLED
 * - Seller marks PAID/PENDING (finalize) -> status changes
 *
 * Controlled seller uplift:
 * - Seller may add extraChargePerUnit above official product selling price
 * - Backend remains source of truth for official/base unit price
 * - If extraChargePerUnit > 0, priceAdjustmentReason is required
 *
 * Discounts:
 * - Existing discount rules remain intact until service logic is updated.
 */

const createSaleSchema = z.object({
  customerId: z.number().int().positive().optional(),
  customerName: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  note: z.string().nullable().optional(),

  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountAmount: z.coerce.number().int().min(0).optional(),

  items: z
    .array(
      z
        .object({
          productId: z.number().int().positive(),
          qty: z.number().int().positive(),

          /**
           * Keep existing compatibility.
           * Service layer should stop trusting this as the official source of truth.
           * Later we can remove it entirely after frontend migration is complete.
           */
          unitPrice: z.coerce.number().int().min(0).optional(),

          /**
           * New controlled seller uplift.
           * This is added on top of official/base product price.
           */
          extraChargePerUnit: z.coerce.number().int().min(0).optional(),

          /**
           * Required when extraChargePerUnit > 0
           */
          priceAdjustmentReason: z.string().trim().min(3).max(300).optional(),

          discountPercent: z.coerce.number().min(0).max(100).optional(),
          discountAmount: z.coerce.number().int().min(0).optional(),
        })
        .superRefine((item, ctx) => {
          const extra = Number(item.extraChargePerUnit || 0);

          if (extra > 0 && !item.priceAdjustmentReason) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["priceAdjustmentReason"],
              message:
                "priceAdjustmentReason is required when extraChargePerUnit is greater than 0",
            });
          }
        }),
    )
    .min(1),
});

/**
 * Seller finalizes AFTER fulfill
 * - PAID => paymentMethod required
 * - PENDING => paymentMethod forbidden
 */
const markSaleSchema = z
  .object({
    status: z.enum(["PAID", "PENDING"]),
    paymentMethod: z.enum(["CASH", "MOMO", "BANK"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "PAID") {
      if (!data.paymentMethod) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentMethod"],
          message: "paymentMethod is required when status is PAID",
        });
      }
    }

    if (data.status === "PENDING") {
      if (data.paymentMethod != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentMethod"],
          message: "paymentMethod must not be provided when status is PENDING",
        });
      }
    }
  });

const cancelSaleSchema = z.object({
  reason: z.string().min(3),
});

const fulfillSaleSchema = z.object({
  note: z.string().max(200).nullable().optional(),
});

module.exports = {
  createSaleSchema,
  markSaleSchema,
  cancelSaleSchema,
  fulfillSaleSchema,
};
