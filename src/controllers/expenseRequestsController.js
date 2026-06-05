"use strict";

const expenseRequestsService = require("../services/expenseRequestsService");

function toInt(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function actorFromRequest(request) {
  return {
    userId: request.user?.id,
    locationId: request.user?.locationId,
    role: request.user?.role,
  };
}

function normalizePayload(body = {}) {
  return {
    locationId: body.locationId,
    cashSessionId: body.cashSessionId,
    category: body.category,
    amount: body.amount,
    expenseDate: body.expenseDate,
    method: body.method,
    payeeName: body.payeeName,
    reference: body.reference,
    note: body.note,
    attachments: Array.isArray(body.attachments) ? body.attachments : [],
  };
}

function mapServiceError(error) {
  const code = error?.code;

  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "NOT_FOUND") return 404;

  if (
    code === "BAD_LOCATION" ||
    code === "BAD_AMOUNT" ||
    code === "BAD_EXPENSE_DATE" ||
    code === "RESERVED_EXPENSE_CATEGORY" ||
    code === "BAD_REQUEST_ID" ||
    code === "BAD_DECISION" ||
    code === "OWNER_DIRECT_EXPENSE"
  ) {
    return 400;
  }

  if (code === "BAD_STATUS") return 409;

  return 500;
}

async function createExpenseRequest(request, reply) {
  try {
    const expenseRequest = await expenseRequestsService.createExpenseRequest(
      normalizePayload(request.body || {}),
      actorFromRequest(request),
    );

    return reply.status(201).send({
      ok: true,
      message: "Expense request sent for owner approval.",
      expenseRequest,
    });
  } catch (error) {
    const status = mapServiceError(error);
    if (status >= 500) {
      request.log.error({ err: error }, "createExpenseRequest failed");
    }

    return reply.status(status).send({
      ok: false,
      error: error?.message || "Failed to create expense request",
      code: error?.code || null,
    });
  }
}

async function listExpenseRequests(request, reply) {
  try {
    const result = await expenseRequestsService.listExpenseRequests(
      {
        status: request.query?.status,
        q: request.query?.q,
        locationId: request.query?.locationId,
        requestedByUserId: request.query?.requestedByUserId,
        cursor: request.query?.cursor,
        limit: request.query?.limit,
      },
      actorFromRequest(request),
    );

    return reply.send({
      ok: true,
      expenseRequests: result.rows,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    const status = mapServiceError(error);
    if (status >= 500) {
      request.log.error({ err: error }, "listExpenseRequests failed");
    }

    return reply.status(status).send({
      ok: false,
      error: error?.message || "Failed to load expense requests",
      code: error?.code || null,
    });
  }
}

async function approveExpenseRequest(request, reply) {
  try {
    const result = await expenseRequestsService.decideExpenseRequest(
      {
        requestId: toInt(request.params?.id, null),
        decision: "APPROVE",
        ownerDecisionNote:
          request.body?.ownerDecisionNote || request.body?.note,
      },
      actorFromRequest(request),
    );

    return reply.send({
      ok: true,
      message: "Expense request approved and posted.",
      expenseRequest: result.request,
      expense: result.expense,
    });
  } catch (error) {
    const status = mapServiceError(error);
    if (status >= 500) {
      request.log.error({ err: error }, "approveExpenseRequest failed");
    }

    return reply.status(status).send({
      ok: false,
      error: error?.message || "Failed to approve expense request",
      code: error?.code || null,
    });
  }
}

async function rejectExpenseRequest(request, reply) {
  try {
    const result = await expenseRequestsService.decideExpenseRequest(
      {
        requestId: toInt(request.params?.id, null),
        decision: "REJECT",
        ownerDecisionNote:
          request.body?.ownerDecisionNote || request.body?.note,
      },
      actorFromRequest(request),
    );

    return reply.send({
      ok: true,
      message: "Expense request rejected.",
      expenseRequest: result.request,
    });
  } catch (error) {
    const status = mapServiceError(error);
    if (status >= 500) {
      request.log.error({ err: error }, "rejectExpenseRequest failed");
    }

    return reply.status(status).send({
      ok: false,
      error: error?.message || "Failed to reject expense request",
      code: error?.code || null,
    });
  }
}

module.exports = {
  createExpenseRequest,
  listExpenseRequests,
  approveExpenseRequest,
  rejectExpenseRequest,
};
