"use strict";

const { z } = require("zod");

const expenseMethodEnum = z.enum(["CASH", "BANK", "MOMO", "CARD", "OTHER"]);
const expenseStatusEnum = z.enum(["POSTED", "VOID"]);

function optionalTrimmedString(max) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === "" ? undefined : s;
  }, z.string().max(max).optional());
}

function optionalPositiveInt() {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : value;
  }, z.number().int().positive().optional());
}

const expenseAttachmentSchema = z.object({
  fileUrl: z.string().trim().min(1).max(1000),
  originalName: optionalTrimmedString(255),
  contentType: optionalTrimmedString(120),
  fileSize: z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "")
        return undefined;
      const n = Number(value);
      return Number.isFinite(n) ? Math.trunc(n) : value;
    },
    z
      .number()
      .int()
      .nonnegative()
      .max(50 * 1024 * 1024)
      .optional(),
  ),
});

const createExpenseSchema = z.object({
  // owner/admin/manager can choose location; staff controller will override
  locationId: optionalPositiveInt(),

  cashSessionId: optionalPositiveInt(),

  category: z.preprocess((value) => {
    if (value === undefined || value === null) return "GENERAL";
    const s = String(value).trim();
    return s === "" ? "GENERAL" : s.toUpperCase();
  }, z.string().min(1).max(60)),

  amount: z.preprocess((value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : value;
  }, z.number().int().positive()),

  expenseDate: optionalTrimmedString(80),
  method: expenseMethodEnum.optional(),
  payeeName: optionalTrimmedString(120),

  reference: optionalTrimmedString(80),
  note: optionalTrimmedString(200),

  attachments: z.array(expenseAttachmentSchema).max(10).optional().default([]),
});

const listExpensesQuerySchema = z.object({
  locationId: optionalPositiveInt(),
  cashSessionId: optionalPositiveInt(),
  cashierId: optionalPositiveInt(),

  category: z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s === "" ? undefined : s.toUpperCase();
  }, z.string().min(1).max(60).optional()),

  method: expenseMethodEnum.optional(),
  status: expenseStatusEnum.optional(),
  q: optionalTrimmedString(200),

  from: optionalTrimmedString(80),
  to: optionalTrimmedString(80),

  cursor: optionalPositiveInt(),

  limit: z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : value;
  }, z.number().int().min(1).max(200).optional()),
});

module.exports = {
  createExpenseSchema,
  listExpensesQuerySchema,
  expenseMethodEnum,
  expenseStatusEnum,
  expenseAttachmentSchema,
};
