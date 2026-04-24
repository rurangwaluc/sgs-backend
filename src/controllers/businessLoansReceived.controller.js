"use strict";

const businessLoansReceivedService = require("../services/businessLoansReceived.service");

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cleanStr(value) {
  return String(value ?? "").trim();
}

function buildActor(request) {
  return {
    userId:
      toInt(request.user?.id, null) ??
      toInt(request.authUser?.id, null) ??
      toInt(request.me?.id, null) ??
      null,
  };
}

function parseListQuery(query = {}) {
  return {
    locationId: query.locationId || null,
    status: query.status || null,
    q: query.q || null,
    limit: query.limit || null,
  };
}

function parseReceiveLoanBody(body = {}) {
  return {
    locationId: body.locationId,
    lenderType: body.lenderType,
    customerId: body.customerId,
    lenderName: body.lenderName,
    lenderPhone: body.lenderPhone,
    lenderEmail: body.lenderEmail,
    principalAmount: body.principalAmount,
    receiptMethod: body.receiptMethod || body.method,
    receivedAt: body.receivedAt,
    dueDate: body.dueDate,
    reference: body.reference,
    note: body.note,
  };
}

function parseRepaymentBody(params = {}, body = {}) {
  return {
    businessLoanId: params.id || body.businessLoanId || body.loanId,
    amount: body.amount,
    method: body.method,
    paidAt: body.paidAt,
    reference: body.reference,
    note: body.note,
  };
}

function sendBadRequest(reply, message, details = null) {
  return reply.status(400).send({
    ok: false,
    error: message,
    details: details || undefined,
  });
}

function mapServiceErrorToStatus(message = "") {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("required") ||
    text.includes("invalid") ||
    text.includes("must be") ||
    text.includes("exceeds remaining balance") ||
    text.includes("already fully repaid") ||
    text.includes("cannot be repaid")
  ) {
    return 400;
  }

  if (text.includes("not found")) {
    return 404;
  }

  return 500;
}

async function createBusinessLoanReceived(request, reply) {
  try {
    const payload = parseReceiveLoanBody(request.body || {});
    const actor = buildActor(request);

    const created = await businessLoansReceivedService.receiveBusinessLoan(
      payload,
      actor,
    );

    return reply.status(201).send({
      ok: true,
      message: "Business loan received recorded successfully",
      loan: created,
    });
  } catch (error) {
    request.log.error({ err: error }, "createBusinessLoanReceived failed");

    const message = error?.message || "Failed to record business loan received";
    const status = mapServiceErrorToStatus(message);

    return reply.status(status).send({
      ok: false,
      error: message,
    });
  }
}

async function createBusinessLoanRepayment(request, reply) {
  try {
    const payload = parseRepaymentBody(
      request.params || {},
      request.body || {},
    );
    const actor = buildActor(request);

    const result = await businessLoansReceivedService.repayBusinessLoan(
      payload,
      actor,
    );

    return reply.status(201).send({
      ok: true,
      message: "Business loan repayment recorded successfully",
      repayment: result?.repayment || null,
      loan: result?.loan || null,
    });
  } catch (error) {
    request.log.error({ err: error }, "createBusinessLoanRepayment failed");

    const message =
      error?.message || "Failed to record business loan repayment";
    const status = mapServiceErrorToStatus(message);

    return reply.status(status).send({
      ok: false,
      error: message,
    });
  }
}

async function listBusinessLoansReceived(request, reply) {
  try {
    const filters = parseListQuery(request.query || {});
    const rows =
      await businessLoansReceivedService.listBusinessLoansReceived(filters);

    return reply.send({
      ok: true,
      rows,
    });
  } catch (error) {
    request.log.error({ err: error }, "listBusinessLoansReceived failed");

    return reply.status(500).send({
      ok: false,
      error: error?.message || "Failed to load business loans received",
    });
  }
}

async function getBusinessLoanReceivedSummary(request, reply) {
  try {
    const filters = {
      locationId: request.query?.locationId || null,
    };

    const summary =
      await businessLoansReceivedService.getBusinessLoansReceivedSummary(
        filters,
      );

    return reply.send({
      ok: true,
      summary,
    });
  } catch (error) {
    request.log.error({ err: error }, "getBusinessLoanReceivedSummary failed");

    return reply.status(500).send({
      ok: false,
      error: error?.message || "Failed to load business loans received summary",
    });
  }
}

async function getBusinessLoanReceivedById(request, reply) {
  try {
    const id = toInt(request.params?.id, null);

    if (!id || id <= 0) {
      return sendBadRequest(reply, "Valid business loan id is required");
    }

    const result =
      await businessLoansReceivedService.getBusinessLoanReceivedById(id);

    if (!result?.loan) {
      return reply.status(404).send({
        ok: false,
        error: "Business loan not found",
      });
    }

    return reply.send({
      ok: true,
      loan: result.loan,
      repayments: Array.isArray(result.repayments) ? result.repayments : [],
    });
  } catch (error) {
    request.log.error({ err: error }, "getBusinessLoanReceivedById failed");

    return reply.status(500).send({
      ok: false,
      error: error?.message || "Failed to load business loan detail",
    });
  }
}

module.exports = {
  createBusinessLoanReceived,
  createBusinessLoanRepayment,
  listBusinessLoansReceived,
  getBusinessLoanReceivedSummary,
  getBusinessLoanReceivedById,
};
