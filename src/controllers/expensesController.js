"use strict";

const {
  createExpenseSchema,
  voidExpenseSchema,
  expenseIdParamsSchema,
  listExpensesQuerySchema,
} = require("../validators/expenses.schema");
const expensesService = require("../services/expensesService");

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function parseIsoDateStart(value) {
  const s = String(value || "").trim();
  if (!s) return null;

  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseIsoDateEndExclusive(value) {
  const s = String(value || "").trim();
  if (!s) return null;

  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;

  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function createExpense(request, reply) {
  const parsed = createExpenseSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid payload",
      details: parsed.error.flatten(),
    });
  }

  const role = normalizeRole(request.user?.role);
  const isOwnerLike =
    role === "owner" || role === "admin" || role === "manager";

  const effectiveLocationId = isOwnerLike
    ? parsed.data.locationId || request.user.locationId
    : request.user.locationId;

  try {
    const expense = await expensesService.createExpense({
      locationId: effectiveLocationId,
      cashierId: request.user.id,
      cashSessionId: parsed.data.cashSessionId,
      category: parsed.data.category,
      amount: parsed.data.amount,
      expenseDate: parsed.data.expenseDate,
      method: parsed.data.method,
      payeeName: parsed.data.payeeName,
      reference: parsed.data.reference,
      note: parsed.data.note,
      attachments: parsed.data.attachments || [],
      allowMissingCashSession: isOwnerLike,
    });

    return reply.send({
      ok: true,
      expense,
    });
  } catch (e) {
    if (e.code === "SESSION_NOT_FOUND") {
      return reply.status(404).send({ error: e.message });
    }

    if (e.code === "NO_OPEN_SESSION") {
      return reply.status(409).send({ error: e.message });
    }

    if (
      e.code === "BAD_LOCATION" ||
      e.code === "BAD_CASHIER" ||
      e.code === "BAD_AMOUNT" ||
      e.code === "BAD_EXPENSE_DATE" ||
      e.code === "BAD_CATEGORY" ||
      e.code === "RESERVED_EXPENSE_CATEGORY"
    ) {
      return reply.status(400).send({ error: e.message });
    }

    request.log.error({ err: e }, "createExpense failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function voidExpense(request, reply) {
  const paramsParsed = expenseIdParamsSchema.safeParse(request.params || {});
  if (!paramsParsed.success) {
    return reply.status(400).send({
      error: "Invalid expense id",
      details: paramsParsed.error.flatten(),
    });
  }

  const bodyParsed = voidExpenseSchema.safeParse(request.body || {});
  if (!bodyParsed.success) {
    return reply.status(400).send({
      error: "Invalid payload",
      details: bodyParsed.error.flatten(),
    });
  }

  try {
    const expense = await expensesService.voidExpense({
      expenseId: paramsParsed.data.id,
      actorUserId: request.user.id,
      reason: bodyParsed.data.reason,
    });

    return reply.send({
      ok: true,
      expense,
    });
  } catch (e) {
    if (e.code === "EXPENSE_NOT_FOUND") {
      return reply.status(404).send({ error: e.message });
    }

    if (e.code === "EXPENSE_NOT_VOIDABLE") {
      return reply.status(409).send({ error: e.message });
    }

    if (
      e.code === "BAD_EXPENSE_ID" ||
      e.code === "BAD_ACTOR" ||
      e.code === "BAD_VOID_REASON"
    ) {
      return reply.status(400).send({ error: e.message });
    }

    request.log.error({ err: e }, "voidExpense failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function listExpenses(request, reply) {
  const parsed = listExpensesQuerySchema.safeParse(request.query || {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
  }

  const role = normalizeRole(request.user?.role);
  const isOwnerLike =
    role === "owner" || role === "admin" || role === "manager";

  try {
    const result = await expensesService.listExpenses({
      locationId: isOwnerLike
        ? (parsed.data.locationId ?? null)
        : request.user.locationId,
      cashSessionId: parsed.data.cashSessionId ?? null,
      cashierId: isOwnerLike
        ? (parsed.data.cashierId ?? null)
        : request.user.id,
      category: parsed.data.category ?? null,
      method: parsed.data.method ?? null,
      status: parsed.data.status ?? null,
      q: parsed.data.q ?? null,
      from: parseIsoDateStart(parsed.data.from),
      toExclusive: parseIsoDateEndExclusive(parsed.data.to),
      cursor: parsed.data.cursor ?? null,
      limit: parsed.data.limit ?? 50,
    });

    return reply.send({
      ok: true,
      expenses: result.rows,
      nextCursor: result.nextCursor,
    });
  } catch (e) {
    request.log.error({ err: e }, "listExpenses failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

module.exports = {
  createExpense,
  voidExpense,
  listExpenses,
};
