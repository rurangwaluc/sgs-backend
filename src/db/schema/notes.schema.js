const {
  pgTable,
  bigserial,
  bigint,
  text,
  boolean,
  timestamp,
  index,
} = require("drizzle-orm/pg-core");

const notes = pgTable(
  "notes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),

    locationId: bigint("location_id", { mode: "number" }).notNull(),
    userId: bigint("user_id", { mode: "number" }).notNull(),

    entity: text("entity").notNull(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),

    parentNoteId: bigint("parent_note_id", { mode: "number" }),
    rootNoteId: bigint("root_note_id", { mode: "number" }),

    body: text("body").notNull(),

    isPinned: boolean("is_pinned").notNull().default(false),

    isResolved: boolean("is_resolved").notNull().default(false),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: bigint("resolved_by", { mode: "number" }),

    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: bigint("deleted_by", { mode: "number" }),

    editedAt: timestamp("edited_at", { withTimezone: true }),
    editedBy: bigint("edited_by", { mode: "number" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    notesLocationIdIdx: index("notes_location_id_idx").on(table.locationId),

    notesUserIdIdx: index("notes_user_id_idx").on(table.userId),

    notesEntityScopeIdx: index("notes_entity_scope_idx").on(
      table.locationId,
      table.entity,
      table.entityId,
      table.id,
    ),

    notesFeedIdx: index("notes_feed_idx").on(table.locationId, table.id),

    notesRootThreadIdx: index("notes_root_thread_idx").on(
      table.locationId,
      table.rootNoteId,
      table.id,
    ),

    notesParentIdx: index("notes_parent_idx").on(
      table.locationId,
      table.parentNoteId,
      table.id,
    ),

    notesThreadScopeIdx: index("notes_thread_scope_idx").on(
      table.locationId,
      table.entity,
      table.entityId,
      table.rootNoteId,
      table.id,
    ),

    notesPinnedIdx: index("notes_pinned_idx").on(
      table.locationId,
      table.entity,
      table.entityId,
      table.isPinned,
      table.id,
    ),

    notesResolvedIdx: index("notes_resolved_idx").on(
      table.locationId,
      table.entity,
      table.entityId,
      table.isResolved,
      table.id,
    ),

    notesDeletedIdx: index("notes_deleted_idx").on(
      table.locationId,
      table.isDeleted,
      table.id,
    ),
  }),
);

module.exports = { notes };
