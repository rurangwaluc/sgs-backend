"use strict";

const { z } = require("zod");
const {
  OWNER_LOAN_RECEIVER_TYPES,
  OWNER_LOAN_METHODS,
  OWNER_LOAN_STATUSES,
} = require("../db/schema/owner_loans.schema");

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

function optionalPositiveIntFromForm() {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }
    return value;
  }, z.coerce.number().int().positive().optional());
}

function optionalNonNegativeIntFromForm() {
  return z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }
    return value;
  }, z.coerce.number().int().min(0).optional());
}

function requiredPositiveIntFromForm(fieldLabel = "Value") {
  return z.preprocess(
    (value) => {
      if (value === "" || value === null || value === undefined) {
        return undefined;
      }
      return value;
    },
    z.coerce
      .number()
      .int()
      .positive({
        message: `${fieldLabel} must be greater than 0`,
      }),
  );
}

function nullableOptionalPositiveIntFromForm() {
  return z.preprocess((value) => {
    if (value === "") return undefined;
    if (value === undefined) return undefined;
    if (value === null) return null;
    return value;
  }, z.coerce.number().int().positive().nullable().optional());
}

const receiverTypeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => OWNER_LOAN_RECEIVER_TYPES.includes(v), {
    message: "Invalid receiverType",
  });

const loanMethodSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => OWNER_LOAN_METHODS.includes(v), {
    message: "Invalid disbursementMethod",
  });

const repaymentMethodSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => OWNER_LOAN_METHODS.includes(v), {
    message: "Invalid method",
  });

const loanStatusSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => OWNER_LOAN_STATUSES.includes(v), {
    message: "Invalid status",
  });

const ownerLoanCreateSchema = z
  .object({
    locationId: optionalPositiveIntFromForm(),

    receiverType: receiverTypeSchema,
    customerId: optionalPositiveIntFromForm(),

    receiverName: z.string().trim().min(1).max(180),
    receiverPhone: optionalTrimmedString(40),
    receiverEmail: optionalTrimmedString(180),

    principalAmount: requiredPositiveIntFromForm("Loan amount"),
    currency: optionalTrimmedString(8),

    disbursementMethod: loanMethodSchema.optional(),
    disbursedAt: optionalDateString(),
    dueDate: optionalDateString(),

    reference: optionalTrimmedString(120),
    note: optionalTrimmedString(4000),

    status: loanStatusSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.receiverType === "CUSTOMER" && !data.customerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "Please select an existing customer",
      });
    }

    if (data.receiverType === "OTHER" && data.customerId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "customerId is only allowed when receiverType is CUSTOMER",
      });
    }

    if (data.disbursedAt && data.dueDate) {
      const disbursed = new Date(data.disbursedAt);
      const due = new Date(data.dueDate);

      if (due < disbursed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dueDate"],
          message: "Repayment date cannot be before disbursement date",
        });
      }
    }

    if (data.status) {
      const normalizedStatus = String(data.status).trim().toUpperCase();

      if (
        normalizedStatus === "PARTIALLY_REPAID" ||
        normalizedStatus === "REPAID"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["status"],
          message:
            "A new loan cannot start as partially repaid or fully repaid",
        });
      }

      if (normalizedStatus === "VOID") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["status"],
          message: "A new loan cannot be created directly as void",
        });
      }
    }
  });

const ownerLoanUpdateSchema = z
  .object({
    receiverType: receiverTypeSchema.optional(),
    customerId: nullableOptionalPositiveIntFromForm(),

    receiverName: z.string().trim().min(1).max(180).optional(),
    receiverPhone: optionalTrimmedString(40),
    receiverEmail: optionalTrimmedString(180),

    principalAmount: optionalPositiveIntFromForm(),
    currency: optionalTrimmedString(8),

    disbursementMethod: loanMethodSchema.optional(),
    disbursedAt: optionalDateString(),
    dueDate: optionalDateString(),

    reference: optionalTrimmedString(120),
    note: optionalTrimmedString(4000),

    status: loanStatusSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (Object.keys(data || {}).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Provide at least one field",
      });
    }

    if (data.receiverType === "CUSTOMER" && data.customerId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customerId"],
        message: "customerId is required when receiverType is CUSTOMER",
      });
    }

    if (data.receiverType === "OTHER" && data.customerId !== undefined) {
      if (data.customerId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customerId"],
          message:
            "customerId must be removed when receiverType is changed to OTHER",
        });
      }
    }

    if (data.disbursedAt && data.dueDate) {
      const disbursed = new Date(data.disbursedAt);
      const due = new Date(data.dueDate);

      if (due < disbursed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["dueDate"],
          message: "dueDate cannot be before disbursedAt",
        });
      }
    }

    if (data.status) {
      const normalizedStatus = String(data.status).trim().toUpperCase();
      if (normalizedStatus === "VOID") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["status"],
          message: "Use the dedicated void flow instead of normal update",
        });
      }
    }
  });

const ownerLoanRepaymentCreateSchema = z.object({
  amount: requiredPositiveIntFromForm("Repayment amount"),
  method: repaymentMethodSchema,
  paidAt: optionalDateString(),
  reference: optionalTrimmedString(120),
  note: optionalTrimmedString(300),
});

const ownerLoanListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  locationId: optionalPositiveIntFromForm(),
  customerId: optionalPositiveIntFromForm(),
  receiverType: receiverTypeSchema.optional(),
  status: loanStatusSchema.optional(),
  dueFrom: optionalDateString(),
  dueTo: optionalDateString(),
  disbursedFrom: optionalDateString(),
  disbursedTo: optionalDateString(),
  limit: optionalPositiveIntFromForm(),
  offset: optionalNonNegativeIntFromForm(),
});

const ownerLoanVoidSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

module.exports = {
  ownerLoanCreateSchema,
  ownerLoanUpdateSchema,
  ownerLoanRepaymentCreateSchema,
  ownerLoanListQuerySchema,
  ownerLoanVoidSchema,
};
