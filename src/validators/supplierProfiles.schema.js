"use strict";

const { z } = require("zod");

const PAYMENT_METHODS = ["CASH", "MOMO", "CARD", "BANK", "OTHER"];
const PAYMENT_TERMS = ["IMMEDIATE", "7_DAYS", "15_DAYS", "30_DAYS", "CUSTOM"];

function cleanOptionalString(max) {
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

const paymentMethodEnum = z.enum(PAYMENT_METHODS);
const paymentTermsEnum = z.enum(PAYMENT_TERMS);

const acceptedPaymentMethodsSchema = z
  .array(paymentMethodEnum)
  .max(PAYMENT_METHODS.length)
  .optional()
  .transform((arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    return [...new Set(arr.map((x) => String(x).trim().toUpperCase()))];
  });

const supplierProfileCreateSchema = z
  .object({
    supplierId: z.coerce.number().int().positive(),

    preferredPaymentMethod: paymentMethodEnum.optional().default("BANK"),
    acceptedPaymentMethods: acceptedPaymentMethodsSchema,

    paymentTermsLabel: paymentTermsEnum.optional().default("IMMEDIATE"),
    paymentTermsDays: z.coerce.number().int().min(0).max(3650).optional(),

    creditLimit: z.coerce.number().int().min(0).optional().default(0),

    bankName: cleanOptionalString(160),
    bankAccountName: cleanOptionalString(180),
    bankAccountNumber: cleanOptionalString(80),
    bankBranch: cleanOptionalString(160),

    momoName: cleanOptionalString(180),
    momoPhone: cleanOptionalString(40),

    taxId: cleanOptionalString(80),
    paymentInstructions: cleanOptionalString(2000),
  })
  .superRefine((data, ctx) => {
    const preferred = String(
      data.preferredPaymentMethod || "BANK",
    ).toUpperCase();
    const termsLabel = String(
      data.paymentTermsLabel || "IMMEDIATE",
    ).toUpperCase();

    const accepted = Array.isArray(data.acceptedPaymentMethods)
      ? data.acceptedPaymentMethods
      : undefined;

    if (accepted && accepted.length > 0 && !accepted.includes(preferred)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptedPaymentMethods"],
        message: "acceptedPaymentMethods must include preferredPaymentMethod",
      });
    }

    if (termsLabel === "IMMEDIATE") {
      if (
        data.paymentTermsDays != null &&
        Number(data.paymentTermsDays) !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentTermsDays"],
          message:
            "paymentTermsDays must be 0 when paymentTermsLabel is IMMEDIATE",
        });
      }
    }

    if (
      termsLabel === "7_DAYS" &&
      data.paymentTermsDays != null &&
      Number(data.paymentTermsDays) !== 7
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentTermsDays"],
        message: "paymentTermsDays must be 7 when paymentTermsLabel is 7_DAYS",
      });
    }

    if (
      termsLabel === "15_DAYS" &&
      data.paymentTermsDays != null &&
      Number(data.paymentTermsDays) !== 15
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentTermsDays"],
        message:
          "paymentTermsDays must be 15 when paymentTermsLabel is 15_DAYS",
      });
    }

    if (
      termsLabel === "30_DAYS" &&
      data.paymentTermsDays != null &&
      Number(data.paymentTermsDays) !== 30
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentTermsDays"],
        message:
          "paymentTermsDays must be 30 when paymentTermsLabel is 30_DAYS",
      });
    }

    if (termsLabel === "CUSTOM") {
      if (data.paymentTermsDays == null || Number(data.paymentTermsDays) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentTermsDays"],
          message:
            "paymentTermsDays is required and must be > 0 when paymentTermsLabel is CUSTOM",
        });
      }
    }

    if (preferred === "BANK") {
      if (!data.bankName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bankName"],
          message: "bankName is required when preferredPaymentMethod is BANK",
        });
      }
      if (!data.bankAccountName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bankAccountName"],
          message:
            "bankAccountName is required when preferredPaymentMethod is BANK",
        });
      }
      if (!data.bankAccountNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bankAccountNumber"],
          message:
            "bankAccountNumber is required when preferredPaymentMethod is BANK",
        });
      }
    }

    if (preferred === "MOMO") {
      if (!data.momoName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["momoName"],
          message: "momoName is required when preferredPaymentMethod is MOMO",
        });
      }
      if (!data.momoPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["momoPhone"],
          message: "momoPhone is required when preferredPaymentMethod is MOMO",
        });
      }
    }
  });

const supplierProfileUpdateBaseSchema = z.object({
  preferredPaymentMethod: paymentMethodEnum.optional(),
  acceptedPaymentMethods: acceptedPaymentMethodsSchema,

  paymentTermsLabel: paymentTermsEnum.optional(),
  paymentTermsDays: z.coerce.number().int().min(0).max(3650).optional(),

  creditLimit: z.coerce.number().int().min(0).optional(),

  bankName: cleanOptionalString(160),
  bankAccountName: cleanOptionalString(180),
  bankAccountNumber: cleanOptionalString(80),
  bankBranch: cleanOptionalString(160),

  momoName: cleanOptionalString(180),
  momoPhone: cleanOptionalString(40),

  taxId: cleanOptionalString(80),
  paymentInstructions: cleanOptionalString(2000),
});

const supplierProfileUpdateSchema = supplierProfileUpdateBaseSchema
  .refine((data) => Object.keys(data || {}).length > 0, {
    message: "Provide at least one field to update",
  })
  .superRefine((data, ctx) => {
    const preferred =
      data.preferredPaymentMethod != null
        ? String(data.preferredPaymentMethod).toUpperCase()
        : null;

    const termsLabel =
      data.paymentTermsLabel != null
        ? String(data.paymentTermsLabel).toUpperCase()
        : null;

    const accepted = Array.isArray(data.acceptedPaymentMethods)
      ? data.acceptedPaymentMethods
      : undefined;

    if (
      preferred &&
      accepted &&
      accepted.length > 0 &&
      !accepted.includes(preferred)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["acceptedPaymentMethods"],
        message: "acceptedPaymentMethods must include preferredPaymentMethod",
      });
    }

    if (termsLabel === "IMMEDIATE") {
      if (
        data.paymentTermsDays != null &&
        Number(data.paymentTermsDays) !== 0
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentTermsDays"],
          message:
            "paymentTermsDays must be 0 when paymentTermsLabel is IMMEDIATE",
        });
      }
    }

    if (
      termsLabel === "7_DAYS" &&
      data.paymentTermsDays != null &&
      Number(data.paymentTermsDays) !== 7
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentTermsDays"],
        message: "paymentTermsDays must be 7 when paymentTermsLabel is 7_DAYS",
      });
    }

    if (
      termsLabel === "15_DAYS" &&
      data.paymentTermsDays != null &&
      Number(data.paymentTermsDays) !== 15
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentTermsDays"],
        message:
          "paymentTermsDays must be 15 when paymentTermsLabel is 15_DAYS",
      });
    }

    if (
      termsLabel === "30_DAYS" &&
      data.paymentTermsDays != null &&
      Number(data.paymentTermsDays) !== 30
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentTermsDays"],
        message:
          "paymentTermsDays must be 30 when paymentTermsLabel is 30_DAYS",
      });
    }

    if (termsLabel === "CUSTOM") {
      if (data.paymentTermsDays == null || Number(data.paymentTermsDays) <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paymentTermsDays"],
          message:
            "paymentTermsDays is required and must be > 0 when paymentTermsLabel is CUSTOM",
        });
      }
    }

    if (preferred === "BANK") {
      if (data.bankName !== undefined && !data.bankName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bankName"],
          message:
            "bankName cannot be empty when preferredPaymentMethod is BANK",
        });
      }
      if (data.bankAccountName !== undefined && !data.bankAccountName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bankAccountName"],
          message:
            "bankAccountName cannot be empty when preferredPaymentMethod is BANK",
        });
      }
      if (data.bankAccountNumber !== undefined && !data.bankAccountNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["bankAccountNumber"],
          message:
            "bankAccountNumber cannot be empty when preferredPaymentMethod is BANK",
        });
      }
    }

    if (preferred === "MOMO") {
      if (data.momoName !== undefined && !data.momoName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["momoName"],
          message:
            "momoName cannot be empty when preferredPaymentMethod is MOMO",
        });
      }
      if (data.momoPhone !== undefined && !data.momoPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["momoPhone"],
          message:
            "momoPhone cannot be empty when preferredPaymentMethod is MOMO",
        });
      }
    }
  });

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_TERMS,
  supplierProfileCreateSchema,
  supplierProfileUpdateSchema,
};
