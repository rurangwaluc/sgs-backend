"use strict";

const {
  createExpenseSchema,
  voidExpenseSchema,
  expenseIdParamsSchema,
  listExpensesQuerySchema,
} = require("../validators/expenses.schema");
const expensesService = require("../services/expensesService");
const expenseRequestsService = require("../services/expenseRequestsService");

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isOwner(role) {
  return normalizeRole(role) === "owner";
}

function isAdmin(role) {
  return normalizeRole(role) === "admin";
}

function isManager(role) {
  return normalizeRole(role) === "manager";
}

function isAdminLike(role) {
  return isOwner(role) || isAdmin(role);
}

function isPrivilegedLocationViewer(role) {
  return isOwner(role) || isAdmin(role) || isManager(role);
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

function resolveCreateLocationId({ role, bodyLocationId, userLocationId }) {
  if (isOwner(role)) {
    return bodyLocationId || userLocationId || null;
  }

  return userLocationId || null;
}

function mapCreateError(e) {
  if (e.code === "SESSION_NOT_FOUND") return 404;
  if (e.code === "NO_OPEN_SESSION") return 409;
  if (e.code === "OWNER_DIRECT_EXPENSE") return 400;

  if (
    e.code === "BAD_LOCATION" ||
    e.code === "BAD_ACTOR" ||
    e.code === "BAD_AMOUNT" ||
    e.code === "BAD_EXPENSE_DATE" ||
    e.code === "BAD_CATEGORY" ||
    e.code === "RESERVED_EXPENSE_CATEGORY"
  ) {
    return 400;
  }

  return 500;
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
  const effectiveLocationId = resolveCreateLocationId({
    role,
    bodyLocationId: parsed.data.locationId,
    userLocationId: request.user?.locationId,
  });

  if (!effectiveLocationId) {
    return reply.status(400).send({
      error: "locationId is required",
    });
  }

  try {
    if (!isOwner(role)) {
      const expenseRequest = await expenseRequestsService.createExpenseRequest(
        {
          locationId: effectiveLocationId,
          cashSessionId: parsed.data.cashSessionId,
          category: parsed.data.category,
          amount: parsed.data.amount,
          expenseDate: parsed.data.expenseDate,
          method: parsed.data.method,
          payeeName: parsed.data.payeeName,
          reference: parsed.data.reference,
          note: parsed.data.note,
          attachments: parsed.data.attachments || [],
        },
        {
          userId: request.user.id,
          locationId: request.user?.locationId,
          role,
        },
      );

      return reply.status(202).send({
        ok: true,
        requiresOwnerApproval: true,
        message: "Expense request sent for owner approval.",
        expenseRequest,
      });
    }

    const expense = await expensesService.createExpense({
      locationId: effectiveLocationId,
      actorUserId: request.user.id,
      actorRole: role,
      cashSessionId: parsed.data.cashSessionId,
      category: parsed.data.category,
      amount: parsed.data.amount,
      expenseDate: parsed.data.expenseDate,
      method: parsed.data.method,
      payeeName: parsed.data.payeeName,
      reference: parsed.data.reference,
      note: parsed.data.note,
      attachments: parsed.data.attachments || [],
      allowMissingCashSession: isAdminLike(role),
    });

    return reply.send({
      ok: true,
      requiresOwnerApproval: false,
      expense,
    });
  } catch (e) {
    const status = mapCreateError(e);
    if (status >= 500) {
      request.log.error({ err: e }, "createExpense failed");
    }

    return reply
      .status(status)
      .send({ error: e.message || "Internal Server Error" });
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
      actorRole: normalizeRole(request.user?.role),
      actorLocationId: request.user?.locationId,
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

    if (e.code === "FORBIDDEN") {
      return reply.status(403).send({ error: e.message });
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

  let effectiveLocationId = null;
  let effectiveCashierId = null;

  if (isOwner(role)) {
    effectiveLocationId = parsed.data.locationId ?? null;
    effectiveCashierId = parsed.data.cashierId ?? null;
  } else if (isPrivilegedLocationViewer(role)) {
    effectiveLocationId = request.user?.locationId ?? null;
    effectiveCashierId = parsed.data.cashierId ?? null;
  } else {
    effectiveLocationId = request.user?.locationId ?? null;
    effectiveCashierId = request.user?.id ?? null;
  }

  try {
    const result = await expensesService.listExpenses({
      locationId: effectiveLocationId,
      cashSessionId: parsed.data.cashSessionId ?? null,
      cashierId: effectiveCashierId,
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
