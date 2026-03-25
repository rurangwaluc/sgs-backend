"use strict";

const { z } = require("zod");

const entityTypeEnum = z.enum(["sale", "credit", "customer"]);

const noteIdSchema = z.coerce.number().int().positive();

const createNoteSchema = z.object({
  entityType: entityTypeEnum,
  entityId: z.coerce.number().int().positive(),
  message: z.string().trim().min(1).max(2000),
  parentNoteId: noteIdSchema.optional(),
});

const listNotesSchema = z
  .object({
    locationId: z.coerce.number().int().positive().optional(),
    entityType: entityTypeEnum.optional(),
    entityId: z.coerce.number().int().positive().optional(),

    rootNoteId: noteIdSchema.optional(),
    parentNoteId: noteIdSchema.optional(),

    onlyRoot: z.coerce.boolean().optional().default(false),
    includeDeleted: z.coerce.boolean().optional().default(false),
    includeResolved: z.coerce.boolean().optional().default(true),

    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    cursor: z.coerce.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.entityId && !data.entityType) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["entityType"],
        message: "entityType is required when entityId is provided",
      });
    }

    if (data.parentNoteId && !data.rootNoteId && !data.entityType) {
      return;
    }

    if ((data.rootNoteId || data.parentNoteId) && !data.locationId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locationId"],
        message:
          "locationId is required when rootNoteId or parentNoteId is provided",
      });
    }
  });

const editNoteSchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

const pinNoteSchema = z.object({
  pinned: z.coerce.boolean().optional().default(true),
});

const resolveNoteSchema = z.object({
  resolved: z.coerce.boolean().optional().default(true),
});

module.exports = {
  createNoteSchema,
  listNotesSchema,
  editNoteSchema,
  pinNoteSchema,
  resolveNoteSchema,
};
