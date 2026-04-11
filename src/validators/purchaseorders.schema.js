"use strict";

const { z } = require("zod");

const PurchaseOrderStatuses = [
  "DRAFT",
  "APPROVED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
];

const PurchaseOrderCurrencies = ["RWF", "USD", "EUR"];

function optionalTrimmedString(max) {
  return z.union([z.string(), z.undefined(), z.null()]).transform((value) => {
    if (value == null) return undefined;
    const text = String(value).trim();
    return text ? text.slice(0, max) : undefined;
  });
}

function optionalDateString(fieldLabel) {
  return z
    .union([z.string(), z.undefined(), z.null()])
    .transform((value) => {
      if (value == null) return undefined;
      const text = String(value).trim();
      return text || undefined;
    })
    .refine((value) => {
      if (!value) return true;
      const d = new Date(value);
      return Number.isFinite(d.getTime());
    }, `${fieldLabel} must be a valid date`);
}

const purchaseOrderItemSchema = z
  .object({
    productId: z.coerce.number().int().positive().optional(),
    productName: optionalTrimmedString(180),
    qtyOrdered: z.coerce.number().int().positive(),
    unitCost: z.coerce.number().int().nonnegative(),
    note: optionalTrimmedString(300),
  })
  .superRefine((item, ctx) => {
    const hasProductId = Number.isInteger(item.productId) && item.productId > 0;
    const hasProductName =
      typeof item.productName === "string" &&
      item.productName.trim().length > 0;

    if (!hasProductId && !hasProductName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each item must include productId or productName",
        path: ["productName"],
      });
    }
  });

const createPurchaseOrderSchema = z
  .object({
    locationId: z.coerce.number().int().positive().optional(),
    supplierId: z.coerce.number().int().positive(),

    poNo: optionalTrimmedString(120),
    reference: optionalTrimmedString(120),

    currency: z
      .union([z.string(), z.undefined(), z.null()])
      .transform((value) => {
        if (value == null) return undefined;
        const text = String(value).trim().toUpperCase();
        return text || undefined;
      })
      .refine((value) => {
        if (!value) return true;
        return PurchaseOrderCurrencies.includes(value);
      }, "Invalid currency"),

    notes: optionalTrimmedString(4000),

    orderedAt: optionalDateString("orderedAt"),
    expectedAt: optionalDateString("expectedAt"),

    items: z.array(purchaseOrderItemSchema).min(1),
  })
  .superRefine((data, ctx) => {
    if (data.orderedAt && data.expectedAt) {
      const orderedAt = new Date(data.orderedAt);
      const expectedAt = new Date(data.expectedAt);

      if (
        Number.isFinite(orderedAt.getTime()) &&
        Number.isFinite(expectedAt.getTime()) &&
        expectedAt.getTime() < orderedAt.getTime()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "expectedAt cannot be earlier than orderedAt",
          path: ["expectedAt"],
        });
      }
    }
  });

const updatePurchaseOrderSchema = z
  .object({
    supplierId: z.coerce.number().int().positive().optional(),

    poNo: optionalTrimmedString(120),
    reference: optionalTrimmedString(120),

    currency: z
      .union([z.string(), z.undefined(), z.null()])
      .transform((value) => {
        if (value == null) return undefined;
        const text = String(value).trim().toUpperCase();
        return text || undefined;
      })
      .refine((value) => {
        if (!value) return true;
        return PurchaseOrderCurrencies.includes(value);
      }, "Invalid currency"),

    notes: optionalTrimmedString(4000),

    orderedAt: optionalDateString("orderedAt"),
    expectedAt: optionalDateString("expectedAt"),

    items: z.array(purchaseOrderItemSchema).min(1).optional(),
  })
  .superRefine((data, ctx) => {
    const hasAnyField =
      data.supplierId !== undefined ||
      data.poNo !== undefined ||
      data.reference !== undefined ||
      data.currency !== undefined ||
      data.notes !== undefined ||
      data.orderedAt !== undefined ||
      data.expectedAt !== undefined ||
      data.items !== undefined;

    if (!hasAnyField) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide at least one field to update",
        path: [],
      });
    }

    if (data.orderedAt && data.expectedAt) {
      const orderedAt = new Date(data.orderedAt);
      const expectedAt = new Date(data.expectedAt);

      if (
        Number.isFinite(orderedAt.getTime()) &&
        Number.isFinite(expectedAt.getTime()) &&
        expectedAt.getTime() < orderedAt.getTime()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "expectedAt cannot be earlier than orderedAt",
          path: ["expectedAt"],
        });
      }
    }
  });

const approvePurchaseOrderSchema = z.object({});

const cancelPurchaseOrderSchema = z.object({
  reason: optionalTrimmedString(300),
});

const listPurchaseOrdersQuerySchema = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),

  status: z
    .union([z.string(), z.undefined(), z.null()])
    .transform((value) => {
      if (value == null) return undefined;
      const text = String(value).trim().toUpperCase();
      return text || undefined;
    })
    .refine((value) => {
      if (!value) return true;
      return PurchaseOrderStatuses.includes(value);
    }, "Invalid status"),

  q: optionalTrimmedString(200),
  from: optionalDateString("from"),
  to: optionalDateString("to"),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

module.exports = {
  PurchaseOrderStatuses,
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  approvePurchaseOrderSchema,
  cancelPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
};
