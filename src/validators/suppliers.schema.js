"use strict";

const { z } = require("zod");

const SOURCE_TYPES = ["LOCAL", "ABROAD"];
const CURRENCIES = ["RWF", "USD"];

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

function optionalEmailString(max) {
  return z
    .string()
    .trim()
    .email()
    .max(max)
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      return v === "" ? undefined : v;
    });
}

function optionalUpperEnum(values, label) {
  return z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v === undefined ? undefined : v))
    .refine((v) => v === undefined || values.includes(v), {
      message: `Invalid ${label}`,
    });
}

function addSupplierCrossFieldValidation(schema) {
  return schema.superRefine((data, ctx) => {
    const sourceType = data.sourceType;
    const defaultCurrency = data.defaultCurrency;

    if (sourceType === "LOCAL" && defaultCurrency === "USD") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultCurrency"],
        message: "LOCAL suppliers should use RWF as defaultCurrency",
      });
    }

    if (sourceType === "ABROAD" && defaultCurrency === "RWF") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultCurrency"],
        message: "ABROAD suppliers should use USD as defaultCurrency",
      });
    }
  });
}

const supplierBaseShape = {
  name: z.string().trim().min(2).max(180),

  contactName: optionalTrimmedString(140),
  phone: optionalTrimmedString(40),
  email: optionalEmailString(140),
  country: optionalTrimmedString(120),
  city: optionalTrimmedString(120),

  sourceType: optionalUpperEnum(SOURCE_TYPES, "sourceType"),
  defaultCurrency: optionalUpperEnum(CURRENCIES, "defaultCurrency"),

  address: optionalTrimmedString(800),
  notes: optionalTrimmedString(2000),
  isActive: z.boolean().optional(),
};

const supplierCreateSchema = addSupplierCrossFieldValidation(
  z.object(supplierBaseShape),
);

const supplierUpdateSchema = addSupplierCrossFieldValidation(
  z.object({
    name: supplierBaseShape.name.optional(),
    contactName: supplierBaseShape.contactName,
    phone: supplierBaseShape.phone,
    email: supplierBaseShape.email,
    country: supplierBaseShape.country,
    city: supplierBaseShape.city,
    sourceType: supplierBaseShape.sourceType,
    defaultCurrency: supplierBaseShape.defaultCurrency,
    address: supplierBaseShape.address,
    notes: supplierBaseShape.notes,
    isActive: supplierBaseShape.isActive,
  }),
).superRefine((data, ctx) => {
  if (Object.keys(data || {}).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [],
      message: "Provide at least one field to update",
    });
  }
});

module.exports = {
  supplierCreateSchema,
  supplierUpdateSchema,
};
