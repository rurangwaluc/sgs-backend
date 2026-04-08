"use strict";

const { db } = require("../config/db");
const { expenses } = require("../db/schema/expenses.schema");
const { cashSessions } = require("../db/schema/cash_sessions.schema");
const { cashLedger } = require("../db/schema/cash_ledger.schema");
const { auditLogs } = require("../db/schema/audit_logs.schema");
const {
  expenseAttachments,
} = require("../db/schema/expense_attachments.schema");
const { eq, and, sql } = require("drizzle-orm");

const ALLOWED_METHODS = new Set(["CASH", "BANK", "MOMO", "CARD", "OTHER"]);
const ALLOWED_STATUSES = new Set(["POSTED", "VOID"]);

const BLOCKED_CATEGORY_EXACT = new Set([
  "STOCK",
  "PURCHASE",
  "PURCHASES",
  "PROCUREMENT",
  "SUPPLIER",
  "SUPPLIERS",
  "INVENTORY",
  "GOODS_RECEIPT",
  "GOODS_RECEIPTS",
  "STOCK_ARRIVAL",
  "STOCK_ARRIVALS",
]);

const BLOCKED_CATEGORY_PARTS = [
  "STOCK",
  "PURCHASE",
  "PROCURE",
  "SUPPLIER",
  "INVENTORY",
  "GOODS RECEIPT",
  "GOODS_RECEIPT",
  "ARRIVAL",
  "WHOLESALE",
  "RESTOCK",
];

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(Math.max(Math.trunc(x), min), max);
}

function toInt(v, fallback = null) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cleanText(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function normalizeMethod(v) {
  const s = String(v || "CASH")
    .trim()
    .toUpperCase();
  return ALLOWED_METHODS.has(s) ? s : "CASH";
}

function normalizeStatus(v) {
  const s = String(v || "POSTED")
    .trim()
    .toUpperCase();
  return ALLOWED_STATUSES.has(s) ? s : "POSTED";
}

function parseExpenseDate(v) {
  if (v == null || v === "") return new Date();
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function rowsOf(result) {
  return result?.rows || result || [];
}

function normalizeCategory(v) {
  return String(v || "GENERAL")
    .trim()
    .toUpperCase()
    .slice(0, 60);
}

function ensureAllowedOperatingExpenseCategory(category) {
  const safeCategory = normalizeCategory(category);

  if (BLOCKED_CATEGORY_EXACT.has(safeCategory)) {
    const err = new Error(
      "Stock or supplier purchasing must go through purchase and supplier flows, not normal expenses",
    );
    err.code = "RESERVED_EXPENSE_CATEGORY";
    throw err;
  }

  for (const token of BLOCKED_CATEGORY_PARTS) {
    if (safeCategory.includes(token)) {
      const err = new Error(
        "Stock or supplier purchasing must go through purchase and supplier flows, not normal expenses",
      );
      err.code = "RESERVED_EXPENSE_CATEGORY";
      throw err;
    }
  }

  return safeCategory;
}

function normalizeAttachments(input) {
  if (!Array.isArray(input)) return [];

  const seen = new Set();
  const out = [];

  for (const item of input) {
    const fileUrl = cleanText(item?.fileUrl, 1000);
    if (!fileUrl) continue;

    const dedupeKey = fileUrl.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      fileUrl,
      originalName: cleanText(item?.originalName, 255),
      contentType: cleanText(item?.contentType, 120),
      fileSize: toInt(item?.fileSize, null),
    });
  }

  return out.slice(0, 10);
}

function mapExpenseRow(row) {
  return {
    id: Number(row.id),
    locationId: Number(row.locationId),
    locationName: row.locationName ?? null,
    locationCode: row.locationCode ?? null,
    cashSessionId: row.cashSessionId == null ? null : Number(row.cashSessionId),
    cashierId: row.cashierId == null ? null : Number(row.cashierId),
    cashierName: row.cashierName ?? null,
    cashierEmail: row.cashierEmail ?? null,
    category: String(row.category || "GENERAL"),
    amount: Number(row.amount || 0),
    expenseDate: row.expenseDate ?? row.createdAt ?? null,
    method: String(row.method || "CASH"),
    status: String(row.status || "POSTED"),
    payeeName: row.payeeName ?? null,
    reference: row.reference ?? null,
    note: row.note ?? null,
    voidedAt: row.voidedAt ?? null,
    voidedByUserId:
      row.voidedByUserId == null ? null : Number(row.voidedByUserId),
    voidReason: row.voidReason ?? null,
    ledgerEntryId: row.ledgerEntryId == null ? null : Number(row.ledgerEntryId),
    attachmentCount:
      row.attachmentCount == null ? 0 : Number(row.attachmentCount),
    createdAt: row.createdAt,
  };
}

async function resolveExpenseCashSessionId(
  tx,
  {
    locationId,
    actorId,
    requestedSessionId,
    method,
    allowMissingCashSession = false,
  },
) {
  const safeMethod = normalizeMethod(method);
  const sessionId = toInt(requestedSessionId, null);

  if (sessionId) {
    const sess = await tx
      .select()
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.id, sessionId),
          eq(cashSessions.locationId, locationId),
        ),
      )
      .limit(1);

    const found = sess[0];
    if (!found) {
      const err = new Error("Cash session not found");
      err.code = "SESSION_NOT_FOUND";
      throw err;
    }

    if (
      safeMethod === "CASH" &&
      String(found.status || "").toUpperCase() !== "OPEN"
    ) {
      const err = new Error("No open cash session");
      err.code = "NO_OPEN_SESSION";
      throw err;
    }

    return Number(found.id);
  }

  if (safeMethod !== "CASH") {
    return null;
  }

  const openRes = await tx.execute(sql`
    SELECT id
    FROM cash_sessions
    WHERE location_id = ${locationId}
      AND cashier_id = ${actorId}
      AND status = 'OPEN'
    ORDER BY opened_at DESC
    LIMIT 1
  `);

  const openRows = rowsOf(openRes);
  if (openRows[0]?.id) {
    return Number(openRows[0].id);
  }

  if (allowMissingCashSession) {
    return null;
  }

  const err = new Error("No open cash session");
  err.code = "NO_OPEN_SESSION";
  throw err;
}

function buildLedgerNote({ category, payeeName, note }) {
  const parts = [`Expense ${category}`];

  if (payeeName) {
    parts.push(`Payee: ${payeeName}`);
  }

  if (note) {
    parts.push(note);
  }

  return parts.join(" | ").slice(0, 500);
}

function buildVoidLedgerNote({ expenseId, category, reason }) {
  const parts = [`Expense void ${category}`, `ExpenseId: ${expenseId}`];
  if (reason) parts.push(`Reason: ${reason}`);
  return parts.join(" | ").slice(0, 500);
}

async function createExpense({
  locationId,
  cashierId,
  cashSessionId,
  category,
  amount,
  expenseDate,
  method,
  payeeName,
  reference,
  note,
  attachments = [],
  allowMissingCashSession = false,
}) {
  return db.transaction(async (tx) => {
    const locId = toInt(locationId, null);
    const actorId = toInt(cashierId, null);
    const safeAmount = toInt(amount, 0);

    if (!locId) {
      const err = new Error("locationId is required");
      err.code = "BAD_LOCATION";
      throw err;
    }

    if (!actorId) {
      const err = new Error("cashierId is required");
      err.code = "BAD_CASHIER";
      throw err;
    }

    if (!safeAmount || safeAmount <= 0) {
      const err = new Error("amount must be greater than zero");
      err.code = "BAD_AMOUNT";
      throw err;
    }

    const safeCategory = ensureAllowedOperatingExpenseCategory(category);

    const safeExpenseDate = parseExpenseDate(expenseDate);
    if (!safeExpenseDate) {
      const err = new Error("expenseDate is invalid");
      err.code = "BAD_EXPENSE_DATE";
      throw err;
    }

    const safeMethod = normalizeMethod(method);
    const safePayeeName = cleanText(payeeName, 120);
    const safeReference = cleanText(reference, 80);
    const safeNote = cleanText(note, 200);
    const safeAttachments = normalizeAttachments(attachments);

    const resolvedSessionId = await resolveExpenseCashSessionId(tx, {
      locationId: locId,
      actorId,
      requestedSessionId: cashSessionId,
      method: safeMethod,
      allowMissingCashSession,
    });

    const [created] = await tx
      .insert(expenses)
      .values({
        locationId: locId,
        cashierId: actorId,
        cashSessionId: resolvedSessionId,
        category: safeCategory,
        amount: safeAmount,
        expenseDate: safeExpenseDate,
        method: safeMethod,
        status: "POSTED",
        payeeName: safePayeeName,
        reference: safeReference,
        note: safeNote,
      })
      .returning();

    const [ledgerEntry] = await tx
      .insert(cashLedger)
      .values({
        locationId: locId,
        cashierId: actorId,
        cashSessionId: resolvedSessionId,
        type: "OPERATING_EXPENSE",
        direction: "OUT",
        amount: safeAmount,
        method: safeMethod,
        reference: safeReference,
        expenseId: Number(created.id),
        note: buildLedgerNote({
          category: safeCategory,
          payeeName: safePayeeName,
          note: safeNote,
        }),
      })
      .returning();

    if (safeAttachments.length) {
      await tx.insert(expenseAttachments).values(
        safeAttachments.map((file) => ({
          expenseId: Number(created.id),
          fileUrl: file.fileUrl,
          originalName: file.originalName,
          contentType: file.contentType,
          fileSize: file.fileSize,
          uploadedByUserId: actorId,
        })),
      );
    }

    await tx.insert(auditLogs).values({
      locationId: locId,
      userId: actorId,
      action: "EXPENSE_CREATE",
      entity: "expense",
      entityId: created.id,
      description: `Expense created amount=${safeAmount}, category=${safeCategory}, method=${safeMethod}, ledgerEntryId=${ledgerEntry.id}, attachments=${safeAttachments.length}, ref=${safeReference || "-"}`,
      meta: {
        expenseId: Number(created.id),
        ledgerEntryId: Number(ledgerEntry.id),
        amount: safeAmount,
        category: safeCategory,
        method: safeMethod,
        cashSessionId: resolvedSessionId,
        expenseDate: safeExpenseDate.toISOString(),
        payeeName: safePayeeName,
        attachmentsCount: safeAttachments.length,
      },
    });

    return mapExpenseRow({
      ...created,
      locationName: null,
      locationCode: null,
      cashierName: null,
      cashierEmail: null,
      ledgerEntryId: Number(ledgerEntry.id),
      attachmentCount: safeAttachments.length,
    });
  });
}

async function voidExpense({ expenseId, actorUserId, reason }) {
  return db.transaction(async (tx) => {
    const safeExpenseId = toInt(expenseId, null);
    const safeActorUserId = toInt(actorUserId, null);
    const safeReason = cleanText(reason, 300);

    if (!safeExpenseId) {
      const err = new Error("expenseId is required");
      err.code = "BAD_EXPENSE_ID";
      throw err;
    }

    if (!safeActorUserId) {
      const err = new Error("actorUserId is required");
      err.code = "BAD_ACTOR";
      throw err;
    }

    if (!safeReason || safeReason.length < 3) {
      const err = new Error("Void reason is required");
      err.code = "BAD_VOID_REASON";
      throw err;
    }

    const foundRes = await tx.execute(sql`
      SELECT
        e.id,
        e.location_id as "locationId",
        e.cash_session_id as "cashSessionId",
        e.cashier_id as "cashierId",
        e.category,
        e.amount,
        e.expense_date as "expenseDate",
        e.method,
        e.status,
        e.payee_name as "payeeName",
        e.reference,
        e.note,
        e.voided_at as "voidedAt",
        e.voided_by_user_id as "voidedByUserId",
        e.void_reason as "voidReason",
        e.created_at as "createdAt"
      FROM expenses e
      WHERE e.id = ${safeExpenseId}
      LIMIT 1
    `);

    const foundRows = rowsOf(foundRes);
    const found = foundRows[0];

    if (!found) {
      const err = new Error("Expense not found");
      err.code = "EXPENSE_NOT_FOUND";
      throw err;
    }

    const currentStatus = normalizeStatus(found.status);
    if (currentStatus !== "POSTED") {
      const err = new Error("Only posted expenses can be voided");
      err.code = "EXPENSE_NOT_VOIDABLE";
      throw err;
    }

    const [updatedExpense] = await tx
      .update(expenses)
      .set({
        status: "VOID",
        voidedAt: new Date(),
        voidedByUserId: safeActorUserId,
        voidReason: safeReason,
      })
      .where(eq(expenses.id, safeExpenseId))
      .returning();

    const [voidLedgerEntry] = await tx
      .insert(cashLedger)
      .values({
        locationId: Number(found.locationId),
        cashierId: safeActorUserId,
        cashSessionId:
          found.cashSessionId == null ? null : Number(found.cashSessionId),
        type: "OPERATING_EXPENSE_VOID",
        direction: "IN",
        amount: Number(found.amount),
        method: normalizeMethod(found.method),
        reference: cleanText(found.reference, 120),
        expenseId: safeExpenseId,
        note: buildVoidLedgerNote({
          expenseId: safeExpenseId,
          category: found.category,
          reason: safeReason,
        }),
      })
      .returning();

    await tx.insert(auditLogs).values({
      locationId: Number(found.locationId),
      userId: safeActorUserId,
      action: "EXPENSE_VOID",
      entity: "expense",
      entityId: safeExpenseId,
      description: `Expense voided expenseId=${safeExpenseId}, ledgerEntryId=${voidLedgerEntry.id}, reason=${safeReason}`,
      meta: {
        expenseId: safeExpenseId,
        voidLedgerEntryId: Number(voidLedgerEntry.id),
        amount: Number(found.amount),
        method: normalizeMethod(found.method),
        reason: safeReason,
      },
    });

    return mapExpenseRow({
      ...updatedExpense,
      ledgerEntryId: null,
      attachmentCount: 0,
      locationName: null,
      locationCode: null,
      cashierName: null,
      cashierEmail: null,
    });
  });
}

async function listExpenses({
  locationId = null,
  cashSessionId = null,
  cashierId = null,
  category = null,
  method = null,
  status = null,
  q = null,
  from = null,
  toExclusive = null,
  cursor = null,
  limit = 50,
}) {
  const lim = clampInt(limit, 1, 200, 50);
  const cursorId = toInt(cursor, null);
  const locationIdInt = toInt(locationId, null);
  const cashSessionIdInt = toInt(cashSessionId, null);
  const cashierIdInt = toInt(cashierId, null);
  const categoryValue = category
    ? String(category).trim().toUpperCase().slice(0, 60)
    : null;
  const methodValue = method ? normalizeMethod(method) : null;
  const statusValue = status ? normalizeStatus(status) : null;
  const qValue = cleanText(q, 200);

  let where = sql`TRUE`;

  if (locationIdInt != null) {
    where = sql`${where} AND e.location_id = ${locationIdInt}`;
  }

  if (cursorId != null && cursorId > 0) {
    where = sql`${where} AND e.id < ${cursorId}`;
  }

  if (cashSessionIdInt != null && cashSessionIdInt > 0) {
    where = sql`${where} AND e.cash_session_id = ${cashSessionIdInt}`;
  }

  if (cashierIdInt != null && cashierIdInt > 0) {
    where = sql`${where} AND e.cashier_id = ${cashierIdInt}`;
  }

  if (categoryValue) {
    where = sql`${where} AND e.category = ${categoryValue}`;
  }

  if (methodValue) {
    where = sql`${where} AND e.method = ${methodValue}`;
  }

  if (statusValue) {
    where = sql`${where} AND e.status = ${statusValue}`;
  }

  if (from) {
    where = sql`${where} AND e.expense_date >= ${from}`;
  }

  if (toExclusive) {
    where = sql`${where} AND e.expense_date < ${toExclusive}`;
  }

  if (qValue) {
    const like = `%${qValue}%`;
    where = sql`${where} AND (
      CAST(e.id AS text) ILIKE ${like}
      OR CAST(e.amount AS text) ILIKE ${like}
      OR COALESCE(e.category, '') ILIKE ${like}
      OR COALESCE(e.method, '') ILIKE ${like}
      OR COALESCE(e.status, '') ILIKE ${like}
      OR COALESCE(e.payee_name, '') ILIKE ${like}
      OR COALESCE(e.reference, '') ILIKE ${like}
      OR COALESCE(e.note, '') ILIKE ${like}
      OR COALESCE(l.name, '') ILIKE ${like}
      OR COALESCE(l.code, '') ILIKE ${like}
      OR COALESCE(u.name, '') ILIKE ${like}
      OR COALESCE(u.email, '') ILIKE ${like}
    )`;
  }

  const result = await db.execute(sql`
    SELECT
      e.id,
      e.location_id as "locationId",
      l.name as "locationName",
      l.code as "locationCode",

      e.cash_session_id as "cashSessionId",
      e.cashier_id as "cashierId",
      u.name as "cashierName",
      u.email as "cashierEmail",

      e.category,
      e.amount,
      e.expense_date as "expenseDate",
      e.method,
      e.status,
      e.payee_name as "payeeName",
      e.reference,
      e.note,
      e.voided_at as "voidedAt",
      e.voided_by_user_id as "voidedByUserId",
      e.void_reason as "voidReason",
      led.id as "ledgerEntryId",
      COALESCE(att.count, 0) as "attachmentCount",
      e.created_at as "createdAt"
    FROM expenses e
    JOIN locations l
      ON l.id = e.location_id
    LEFT JOIN users u
      ON u.id = e.cashier_id
    LEFT JOIN LATERAL (
      SELECT cl.id
      FROM cash_ledger cl
      WHERE cl.expense_id = e.id
        AND cl.type = 'OPERATING_EXPENSE'
        AND cl.direction = 'OUT'
      ORDER BY cl.id ASC
      LIMIT 1
    ) led ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int as count
      FROM expense_attachments ea
      WHERE ea.expense_id = e.id
    ) att ON TRUE
    WHERE ${where}
    ORDER BY e.id DESC
    LIMIT ${lim}
  `);

  const rows = rowsOf(result).map(mapExpenseRow);
  const nextCursor = rows.length === lim ? rows[rows.length - 1].id : null;

  return { rows, nextCursor };
}

module.exports = {
  createExpense,
  voidExpense,
  listExpenses,
};
