"use strict";

const { z } = require("zod");

const BILL_STATUSES_CREATE = [
  "DRAFT",
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
  "VOID",
];

const BILL_STATUSES_UPDATE = ["DRAFT", "OPEN", "PARTIALLY_PAID", "PAID"];

const PAYMENT_METHODS = ["CASH", "MOMO", "BANK", "CARD", "OTHER"];

function optionalTrimmedString(max) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "" ? undefined : v;
    });
}

function optionalDateString() {
  return z
    .string()
    .trim()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "" ? undefined : v;
    })
    .refine(
      (v) => {
        if (v === undefined) return true;
        return !Number.isNaN(new Date(v).getTime());
      },
      { message: "Invalid date" },
    );
}

const billItemSchema = z.object({
  productId: z.coerce.number().int().positive().optional(),
  description: z.string().trim().min(1).max(240),
  qty: z.coerce.number().int().positive(),
  unitCost: z.coerce.number().int().nonnegative(),
});

const supplierBillCreateSchema = z
  .object({
    supplierId: z.coerce.number().int().positive(),
    locationId: z.coerce.number().int().positive().optional(),

    purchaseOrderId: z.coerce.number().int().positive().optional(),
    goodsReceiptId: z.coerce.number().int().positive().optional(),

    billNo: optionalTrimmedString(80),
    currency: optionalTrimmedString(8),
    totalAmount: z.coerce.number().int().positive().optional(),
    issuedDate: optionalDateString(),
    dueDate: optionalDateString(),
    note: optionalTrimmedString(2000),
    status: z.enum(BILL_STATUSES_CREATE).optional(),
    items: z.array(billItemSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const hasItems = Array.isArray(data.items) && data.items.length > 0;
    const hasTotal = Number.isInteger(data.totalAmount) && data.totalAmount > 0;

    if (!hasItems && !hasTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "Provide items or totalAmount",
      });
    }

    if (hasItems && hasTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalAmount"],
        message: "Use items or totalAmount, not both",
      });
    }

    if (data.goodsReceiptId && !data.purchaseOrderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purchaseOrderId"],
        message: "purchaseOrderId is required when goodsReceiptId is provided",
      });
    }

    if (data.issuedDate && data.dueDate) {
      const issued = new Date(data.issuedDate);
      const due = new Date(data.dueDate);
      if (due < issued) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dueDate"],
          message: "dueDate cannot be before issuedDate",
        });
      }
    }
  });

const supplierBillUpdateSchema = z
  .object({
    supplierId: z.coerce.number().int().positive().optional(),
    locationId: z.coerce.number().int().positive().optional(),

    purchaseOrderId: z.coerce.number().int().positive().optional(),
    goodsReceiptId: z.coerce.number().int().positive().optional(),

    billNo: optionalTrimmedString(80),
    currency: optionalTrimmedString(8),
    totalAmount: z.coerce.number().int().positive().optional(),
    issuedDate: optionalDateString(),
    dueDate: optionalDateString(),
    note: optionalTrimmedString(2000),
    status: z.enum(BILL_STATUSES_UPDATE).optional(),
    items: z.array(billItemSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (Object.keys(data || {}).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Provide at least one field",
      });
    }

    if (data.items && data.totalAmount !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalAmount"],
        message: "Use items or totalAmount, not both",
      });
    }

    if (data.items && data.items.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items"],
        message: "items cannot be empty",
      });
    }

    if (data.goodsReceiptId && !data.purchaseOrderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purchaseOrderId"],
        message: "purchaseOrderId is required when goodsReceiptId is provided",
      });
    }

    if (data.issuedDate && data.dueDate) {
      const issued = new Date(data.issuedDate);
      const due = new Date(data.dueDate);
      if (due < issued) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dueDate"],
          message: "dueDate cannot be before issuedDate",
        });
      }
    }
  });

const supplierBillPaymentCreateSchema = z.object({
  amount: z.coerce.number().int().positive(),
  method: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .transform((v) => v.toUpperCase())
    .refine((v) => PAYMENT_METHODS.includes(v), {
      message: "Invalid payment method",
    }),
  reference: optionalTrimmedString(120),
  note: optionalTrimmedString(200),
  paidAt: optionalDateString(),
});

module.exports = {
  supplierBillCreateSchema,
  supplierBillUpdateSchema,
  supplierBillPaymentCreateSchema,
};
