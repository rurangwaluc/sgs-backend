"use strict";

const { db } = require("../config/db");
const { sql } = require("drizzle-orm");
const expensesService = require("./expensesService");
const notificationService = require("./notificationService");

const REQUEST_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);
const METHODS = new Set(["CASH", "BANK", "MOMO", "CARD", "OTHER"]);

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

function rowsOf(result) {
  return result?.rows || result || [];
}

function firstRow(result) {
  return rowsOf(result)[0] || null;
}

function toInt(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cleanText(value, max = 500) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isOwner(role) {
  return normalizeRole(role) === "owner";
}

function normalizeMethod(value) {
  const method = String(value || "BANK")
    .trim()
    .toUpperCase();
  return METHODS.has(method) ? method : "BANK";
}

function normalizeStatus(value) {
  const status = String(value || "")
    .trim()
    .toUpperCase();
  return REQUEST_STATUSES.has(status) ? status : null;
}

function normalizeCategory(value) {
  return String(value || "GENERAL")
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

function parseExpenseDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    const err = new Error("Expense date is invalid");
    err.code = "BAD_EXPENSE_DATE";
    throw err;
  }
  return date;
}

function normalizeAttachments(input) {
  if (!Array.isArray(input)) return [];

  const out = [];
  const seen = new Set();

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

function mapRequestRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    locationId: Number(row.locationId ?? row.location_id),
    locationName: row.locationName ?? row.location_name ?? null,
    locationCode: row.locationCode ?? row.location_code ?? null,
    requestedByUserId: Number(
      row.requestedByUserId ?? row.requested_by_user_id,
    ),
    requestedByName: row.requestedByName ?? row.requested_by_name ?? null,
    requestedByEmail: row.requestedByEmail ?? row.requested_by_email ?? null,
    requestedByRole: row.requestedByRole ?? row.requested_by_role ?? null,
    cashSessionId:
      (row.cashSessionId ?? row.cash_session_id) == null
        ? null
        : Number(row.cashSessionId ?? row.cash_session_id),
    category: String(row.category || "GENERAL"),
    amount: Number(row.amount || 0),
    expenseDate: row.expenseDate ?? row.expense_date ?? null,
    method: String(row.method || "BANK"),
    payeeName: row.payeeName ?? row.payee_name ?? null,
    reference: row.reference ?? null,
    note: row.note ?? null,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    status: String(row.status || "PENDING"),
    ownerDecisionNote: row.ownerDecisionNote ?? row.owner_decision_note ?? null,
    decidedByUserId:
      (row.decidedByUserId ?? row.decided_by_user_id) == null
        ? null
        : Number(row.decidedByUserId ?? row.decided_by_user_id),
    decidedAt: row.decidedAt ?? row.decided_at ?? null,
    postedExpenseId:
      (row.postedExpenseId ?? row.posted_expense_id) == null
        ? null
        : Number(row.postedExpenseId ?? row.posted_expense_id),
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  };
}

function assertAuthenticatedActor(actor = {}) {
  const userId = toInt(actor.userId, null);
  const locationId = toInt(actor.locationId, null);
  const role = normalizeRole(actor.role);

  if (!userId) {
    const err = new Error("Unauthorized");
    err.code = "UNAUTHORIZED";
    throw err;
  }

  return { userId, locationId, role };
}

async function createExpenseRequest(input = {}, actor = {}) {
  const safeActor = assertAuthenticatedActor(actor);

  if (isOwner(safeActor.role)) {
    const err = new Error("Owner can record expenses directly");
    err.code = "OWNER_DIRECT_EXPENSE";
    throw err;
  }

  const requestedLocationId = toInt(input.locationId, null);
  const locationId = safeActor.locationId || requestedLocationId;
  const amount = toInt(input.amount, 0);

  if (!locationId) {
    const err = new Error("Branch is required");
    err.code = "BAD_LOCATION";
    throw err;
  }

  if (!amount || amount <= 0) {
    const err = new Error("Amount must be greater than zero");
    err.code = "BAD_AMOUNT";
    throw err;
  }

  const category = ensureAllowedOperatingExpenseCategory(input.category);
  const method = normalizeMethod(input.method);
  const expenseDate = parseExpenseDate(input.expenseDate);
  const cashSessionId = toInt(input.cashSessionId, null);
  const payeeName = cleanText(input.payeeName, 120);
  const reference = cleanText(input.reference, 80);
  const note = cleanText(input.note, 200);
  const attachments = normalizeAttachments(input.attachments);

  const inserted = await db.execute(sql`
    INSERT INTO expense_requests (
      location_id,
      requested_by_user_id,
      requested_by_role,
      cash_session_id,
      category,
      amount,
      expense_date,
      method,
      payee_name,
      reference,
      note,
      attachments,
      status
    )
    VALUES (
      ${locationId},
      ${safeActor.userId},
      ${safeActor.role},
      ${cashSessionId},
      ${category},
      ${amount},
      ${expenseDate},
      ${method},
      ${payeeName},
      ${reference},
      ${note},
      ${JSON.stringify(attachments)}::jsonb,
      ${"PENDING"}
    )
    RETURNING *
  `);

  const created = mapRequestRow(firstRow(inserted));

  await db.execute(sql`
    INSERT INTO audit_logs (
      location_id,
      user_id,
      action,
      entity,
      entity_id,
      description,
      meta
    )
    VALUES (
      ${locationId},
      ${safeActor.userId},
      ${"EXPENSE_REQUEST_CREATE"},
      ${"expense_request"},
      ${created.id},
      ${`Expense request created amount=${amount}, category=${category}, method=${method}`},
      ${JSON.stringify({
        requestId: created.id,
        amount,
        category,
        method,
        actorRole: safeActor.role,
      })}::jsonb
    )
  `);

  await notificationService.notifyRoles({
    locationId,
    roles: ["owner"],
    actorUserId: safeActor.userId,
    type: "EXPENSE_REQUEST_CREATED",
    title: "Expense request needs approval",
    body: `Expense request #${created.id} needs owner approval.`,
    priority: "high",
    entity: "expense_request",
    entityId: created.id,
  });

  return created;
}

async function listExpenseRequests(filters = {}, actor = {}) {
  const safeActor = assertAuthenticatedActor(actor);
  const status = normalizeStatus(filters.status);
  const limit = Math.min(Math.max(toInt(filters.limit, 50) || 50, 1), 200);
  const cursor = toInt(filters.cursor, null);
  const q = cleanText(filters.q, 200);
  const requestedByUserId = toInt(filters.requestedByUserId, null);
  const locationIdFilter = toInt(filters.locationId, null);

  let scope = sql`TRUE`;

  if (isOwner(safeActor.role)) {
    if (locationIdFilter) {
      scope = sql`${scope} AND er.location_id = ${locationIdFilter}`;
    }

    if (requestedByUserId) {
      scope = sql`${scope} AND er.requested_by_user_id = ${requestedByUserId}`;
    }
  } else {
    scope = sql`${scope} AND er.requested_by_user_id = ${safeActor.userId}`;
  }

  if (status) {
    scope = sql`${scope} AND er.status = ${status}`;
  }

  if (cursor && cursor > 0) {
    scope = sql`${scope} AND er.id < ${cursor}`;
  }

  if (q) {
    const like = `%${q}%`;
    scope = sql`${scope} AND (
      CAST(er.id AS text) ILIKE ${like}
      OR CAST(er.amount AS text) ILIKE ${like}
      OR COALESCE(er.category, '') ILIKE ${like}
      OR COALESCE(er.method, '') ILIKE ${like}
      OR COALESCE(er.payee_name, '') ILIKE ${like}
      OR COALESCE(er.reference, '') ILIKE ${like}
      OR COALESCE(er.note, '') ILIKE ${like}
      OR COALESCE(l.name, '') ILIKE ${like}
      OR COALESCE(l.code, '') ILIKE ${like}
      OR COALESCE(u.name, '') ILIKE ${like}
      OR COALESCE(u.email, '') ILIKE ${like}
    )`;
  }

  const result = await db.execute(sql`
    SELECT
      er.id,
      er.location_id AS "locationId",
      l.name AS "locationName",
      l.code AS "locationCode",
      er.requested_by_user_id AS "requestedByUserId",
      u.name AS "requestedByName",
      u.email AS "requestedByEmail",
      er.requested_by_role AS "requestedByRole",
      er.cash_session_id AS "cashSessionId",
      er.category,
      er.amount,
      er.expense_date AS "expenseDate",
      er.method,
      er.payee_name AS "payeeName",
      er.reference,
      er.note,
      er.attachments,
      er.status,
      er.owner_decision_note AS "ownerDecisionNote",
      er.decided_by_user_id AS "decidedByUserId",
      er.decided_at AS "decidedAt",
      er.posted_expense_id AS "postedExpenseId",
      er.created_at AS "createdAt",
      er.updated_at AS "updatedAt"
    FROM expense_requests er
    JOIN locations l ON l.id = er.location_id
    LEFT JOIN users u ON u.id = er.requested_by_user_id
    WHERE ${scope}
    ORDER BY er.id DESC
    LIMIT ${limit}
  `);

  const rows = rowsOf(result).map(mapRequestRow).filter(Boolean);
  const nextCursor = rows.length === limit ? rows[rows.length - 1].id : null;

  return { rows, nextCursor };
}

async function decideExpenseRequest(input = {}, actor = {}) {
  const safeActor = assertAuthenticatedActor(actor);

  if (!isOwner(safeActor.role)) {
    const err = new Error("Only owner can approve or reject expense requests");
    err.code = "FORBIDDEN";
    throw err;
  }

  const requestId = toInt(input.requestId, null);
  const decision = String(input.decision || "")
    .trim()
    .toUpperCase();
  const ownerDecisionNote = cleanText(
    input.ownerDecisionNote || input.note,
    300,
  );

  if (!requestId) {
    const err = new Error("Expense request id is required");
    err.code = "BAD_REQUEST_ID";
    throw err;
  }

  if (!["APPROVE", "REJECT"].includes(decision)) {
    const err = new Error("Decision must be APPROVE or REJECT");
    err.code = "BAD_DECISION";
    throw err;
  }

  return db.transaction(async (tx) => {
    const lockedRes = await tx.execute(sql`
      SELECT *
      FROM expense_requests
      WHERE id = ${requestId}
      FOR UPDATE
    `);

    const locked = firstRow(lockedRes);

    if (!locked) {
      const err = new Error("Expense request not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    if (String(locked.status || "").toUpperCase() !== "PENDING") {
      const err = new Error("Expense request is already decided");
      err.code = "BAD_STATUS";
      throw err;
    }

    if (decision === "REJECT") {
      const rejectedRes = await tx.execute(sql`
        UPDATE expense_requests
        SET
          status = 'REJECTED',
          owner_decision_note = ${ownerDecisionNote},
          decided_by_user_id = ${safeActor.userId},
          decided_at = now(),
          updated_at = now()
        WHERE id = ${requestId}
        RETURNING *
      `);

      const rejected = mapRequestRow(firstRow(rejectedRes));

      await tx.execute(sql`
        INSERT INTO audit_logs (
          location_id,
          user_id,
          action,
          entity,
          entity_id,
          description,
          meta
        )
        VALUES (
          ${locked.location_id},
          ${safeActor.userId},
          ${"EXPENSE_REQUEST_REJECT"},
          ${"expense_request"},
          ${requestId},
          ${`Expense request #${requestId} rejected`},
          ${JSON.stringify({ requestId, ownerDecisionNote })}::jsonb
        )
      `);

      await notificationService.createNotifications({
        locationId: locked.location_id,
        recipientUserIds: [locked.requested_by_user_id],
        actorUserId: safeActor.userId,
        type: "EXPENSE_REQUEST_REJECTED",
        title: "Expense request rejected",
        body: `Expense request #${requestId} was rejected by owner.`,
        priority: "normal",
        entity: "expense_request",
        entityId: requestId,
      });

      return { request: rejected, expense: null };
    }

    const postedExpense = await expensesService.createExpense({
      locationId: locked.location_id,
      actorUserId: locked.requested_by_user_id,
      actorRole: locked.requested_by_role,
      cashSessionId: locked.cash_session_id,
      category: locked.category,
      amount: locked.amount,
      expenseDate: locked.expense_date,
      method: locked.method,
      payeeName: locked.payee_name,
      reference: locked.reference,
      note: locked.note,
      attachments: Array.isArray(locked.attachments) ? locked.attachments : [],
      allowMissingCashSession: true,
    });

    const approvedRes = await tx.execute(sql`
      UPDATE expense_requests
      SET
        status = 'APPROVED',
        owner_decision_note = ${ownerDecisionNote},
        decided_by_user_id = ${safeActor.userId},
        decided_at = now(),
        posted_expense_id = ${postedExpense.id},
        updated_at = now()
      WHERE id = ${requestId}
      RETURNING *
    `);

    const approved = mapRequestRow(firstRow(approvedRes));

    await tx.execute(sql`
      INSERT INTO audit_logs (
        location_id,
        user_id,
        action,
        entity,
        entity_id,
        description,
        meta
      )
      VALUES (
        ${locked.location_id},
        ${safeActor.userId},
        ${"EXPENSE_REQUEST_APPROVE"},
        ${"expense_request"},
        ${requestId},
        ${`Expense request #${requestId} approved and posted as expense #${postedExpense.id}`},
        ${JSON.stringify({
          requestId,
          expenseId: postedExpense.id,
          ownerDecisionNote,
        })}::jsonb
      )
    `);

    await notificationService.createNotifications({
      locationId: locked.location_id,
      recipientUserIds: [locked.requested_by_user_id],
      actorUserId: safeActor.userId,
      type: "EXPENSE_REQUEST_APPROVED",
      title: "Expense request approved",
      body: `Expense request #${requestId} was approved by owner.`,
      priority: "normal",
      entity: "expense_request",
      entityId: requestId,
    });

    return { request: approved, expense: postedExpense };
  });
}

module.exports = {
  createExpenseRequest,
  listExpenseRequests,
  decideExpenseRequest,
};
