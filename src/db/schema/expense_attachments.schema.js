const {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  bigint,
  index,
} = require("drizzle-orm/pg-core");
const { expenses } = require("./expenses.schema");
const { users } = require("./users.schema");

const expenseAttachments = pgTable(
  "expense_attachments",
  {
    id: serial("id").primaryKey(),

    expenseId: integer("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),

    fileUrl: text("file_url").notNull(),
    originalName: varchar("original_name", { length: 255 }),
    contentType: varchar("content_type", { length: 120 }),
    fileSize: bigint("file_size", { mode: "number" }),

    uploadedByUserId: integer("uploaded_by_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    expenseAttachmentsExpenseIdx: index("expense_attachments_expense_idx").on(
      t.expenseId,
    ),
    expenseAttachmentsUploaderIdx: index("expense_attachments_uploader_idx").on(
      t.uploadedByUserId,
    ),
  }),
);

module.exports = { expenseAttachments };
