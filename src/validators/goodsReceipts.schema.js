"use strict";

const { z } = require("zod");

function optionalTrimmedString(max) {
  return z
    .union([z.string(), z.undefined(), z.null()])
    .transform((value) => {
      if (value == null) return undefined;
      const s = String(value).trim();
      return s ? s : undefined;
    })
    .refine(
      (value) => value === undefined || value.length <= max,
      `Must be at most ${max} characters`,
    );
}

const receiveItemSchema = z.object({
  purchaseOrderItemId: z.coerce.number().int().positive(),
  qtyReceived: z.coerce.number().int().positive(),
  note: optionalTrimmedString(300),
});

const createGoodsReceiptSchema = z
  .object({
    locationId: z.coerce.number().int().positive().optional(),

    purchaseOrderId: z.coerce.number().int().positive(),

    receiptNo: optionalTrimmedString(120),
    reference: optionalTrimmedString(120),
    note: optionalTrimmedString(4000),
    receivedAt: optionalTrimmedString(80),

    items: z
      .array(receiveItemSchema)
      .min(1, "At least one receipt line is required"),
  })
  .superRefine((data, ctx) => {
    const seen = new Set();

    for (let i = 0; i < data.items.length; i += 1) {
      const item = data.items[i];
      const key = Number(item.purchaseOrderItemId);

      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", i, "purchaseOrderItemId"],
          message: "Duplicate purchase order item is not allowed",
        });
      } else {
        seen.add(key);
      }
    }
  });

const listGoodsReceiptsQuerySchema = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  purchaseOrderId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),

  q: optionalTrimmedString(200),
  from: optionalTrimmedString(80),
  to: optionalTrimmedString(80),

  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

module.exports = {
  createGoodsReceiptSchema,
  listGoodsReceiptsQuerySchema,
};
