const { z } = require("zod");

const saleItemSchema = z
  .object({
    productId: z.number().int().positive(),
    qty: z.number().int().positive(),
    unitPrice: z.coerce.number().int().min(0).optional(),
    extraChargePerUnit: z.coerce.number().int().min(0).optional(),
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
  });

const salePayloadSchema = z.object({
  customerId: z.number().int().positive().optional(),
  customerName: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  note: z.string().nullable().optional(),

  discountPercent: z.coerce.number().min(0).max(100).optional(),
  discountAmount: z.coerce.number().int().min(0).optional(),

  items: z.array(saleItemSchema).min(1),
});

const createSaleSchema = salePayloadSchema;
const updateSaleSchema = salePayloadSchema;

const markSaleSchema = z
  .object({
    status: z.enum(["PAID", "PENDING"]),
    paymentMethod: z.enum(["CASH", "MOMO", "BANK"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "PAID" && !data.paymentMethod) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentMethod"],
        message: "paymentMethod is required when status is PAID",
      });
    }

    if (data.status === "PENDING" && data.paymentMethod != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentMethod"],
        message: "paymentMethod must not be provided when status is PENDING",
      });
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
  updateSaleSchema,
  markSaleSchema,
  cancelSaleSchema,
  fulfillSaleSchema,
};
