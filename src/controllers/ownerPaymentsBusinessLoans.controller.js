"use strict";

const ownerPaymentsBusinessLoansService = require("../services/ownerPaymentsBusinessLoans.service");

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
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

function parseReceiveBody(body = {}) {
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

function parseRepaymentBody(body = {}) {
  return {
    amount: body.amount,
    method: body.method,
    paidAt: body.paidAt,
    reference: body.reference,
    note: body.note,
  };
}

function parseVoidBody(body = {}) {
  return {
    reason: body.reason || body.voidReason || body.note,
  };
}

function mapServiceErrorToStatus(message = "") {
  const text = String(message || "").toLowerCase();

  if (
    text.includes("required") ||
    text.includes("invalid") ||
    text.includes("must be") ||
    text.includes("exceeds remaining balance") ||
    text.includes("already fully repaid") ||
    text.includes("cannot be repaid") ||
    text.includes("already voided") ||
    text.includes("void is blocked")
  ) {
    return 400;
  }

  if (text.includes("not found")) {
    return 404;
  }

  return 500;
}

async function listOwnerPaymentBusinessLoans(request, reply) {
  try {
    const filters = parseListQuery(request.query || {});
    const result =
      await ownerPaymentsBusinessLoansService.getBusinessLoansListForOwnerPayments(
        filters,
      );

    return reply.send({
      ok: true,
      summary: result?.summary || null,
      rows: Array.isArray(result?.rows) ? result.rows : [],
    });
  } catch (error) {
    request.log.error({ err: error }, "listOwnerPaymentBusinessLoans failed");

    return reply.status(500).send({
      ok: false,
      error: error?.message || "Failed to load owner payment business loans",
    });
  }
}

async function getOwnerPaymentBusinessLoansSummary(request, reply) {
  try {
    const filters = parseListQuery(request.query || {});
    const summary =
      await ownerPaymentsBusinessLoansService.getBusinessLoansSummaryForOwnerPayments(
        filters,
      );

    return reply.send({
      ok: true,
      summary,
    });
  } catch (error) {
    request.log.error(
      { err: error },
      "getOwnerPaymentBusinessLoansSummary failed",
    );

    return reply.status(500).send({
      ok: false,
      error:
        error?.message || "Failed to load owner payment business loans summary",
    });
  }
}

async function getOwnerPaymentBusinessLoanDetail(request, reply) {
  try {
    const id = request.params?.id;
    const result =
      await ownerPaymentsBusinessLoansService.getBusinessLoanDetailForOwnerPayments(
        id,
      );

    return reply.send({
      ok: true,
      loan: result?.loan || null,
      repayments: Array.isArray(result?.repayments) ? result.repayments : [],
    });
  } catch (error) {
    request.log.error(
      { err: error },
      "getOwnerPaymentBusinessLoanDetail failed",
    );

    const message = error?.message || "Failed to load business loan detail";
    const status = mapServiceErrorToStatus(message);

    return reply.status(status).send({
      ok: false,
      error: message,
    });
  }
}

async function createOwnerPaymentBusinessLoan(request, reply) {
  try {
    const actor = buildActor(request);
    const payload = parseReceiveBody(request.body || {});

    const loan =
      await ownerPaymentsBusinessLoansService.receiveBusinessLoanFromOwnerPayments(
        payload,
        actor,
      );

    const summary =
      await ownerPaymentsBusinessLoansService.getBusinessLoansSummaryForOwnerPayments(
        { locationId: payload.locationId || null },
      );

    return reply.status(201).send({
      ok: true,
      message: "Business loan received recorded successfully",
      loan,
      summary,
    });
  } catch (error) {
    request.log.error({ err: error }, "createOwnerPaymentBusinessLoan failed");

    const message = error?.message || "Failed to record business loan received";
    const status = mapServiceErrorToStatus(message);

    return reply.status(status).send({
      ok: false,
      error: message,
    });
  }
}

async function createOwnerPaymentBusinessLoanRepayment(request, reply) {
  try {
    const actor = buildActor(request);
    const businessLoanId = request.params?.id;
    const payload = parseRepaymentBody(request.body || {});

    const result =
      await ownerPaymentsBusinessLoansService.repayBusinessLoanFromOwnerPayments(
        businessLoanId,
        payload,
        actor,
      );

    const summary =
      await ownerPaymentsBusinessLoansService.getBusinessLoansSummaryForOwnerPayments(
        { locationId: result?.loan?.locationId || null },
      );

    return reply.status(201).send({
      ok: true,
      message: "Business loan repayment recorded successfully",
      repayment: result?.repayment || null,
      loan: result?.loan || null,
      summary,
    });
  } catch (error) {
    request.log.error(
      { err: error },
      "createOwnerPaymentBusinessLoanRepayment failed",
    );

    const message =
      error?.message || "Failed to record business loan repayment";
    const status = mapServiceErrorToStatus(message);

    return reply.status(status).send({
      ok: false,
      error: message,
    });
  }
}

async function voidOwnerPaymentBusinessLoan(request, reply) {
  try {
    const actor = buildActor(request);
    const businessLoanId = request.params?.id;
    const payload = parseVoidBody(request.body || {});

    const loan =
      await ownerPaymentsBusinessLoansService.voidBusinessLoanFromOwnerPayments(
        businessLoanId,
        payload,
        actor,
      );

    const summary =
      await ownerPaymentsBusinessLoansService.getBusinessLoansSummaryForOwnerPayments(
        { locationId: loan?.locationId || null },
      );

    return reply.send({
      ok: true,
      message: "Business loan voided successfully",
      loan,
      summary,
    });
  } catch (error) {
    request.log.error({ err: error }, "voidOwnerPaymentBusinessLoan failed");

    const message = error?.message || "Failed to void business loan";
    const status = mapServiceErrorToStatus(message);

    return reply.status(status).send({
      ok: false,
      error: message,
    });
  }
}

module.exports = {
  listOwnerPaymentBusinessLoans,
  getOwnerPaymentBusinessLoansSummary,
  getOwnerPaymentBusinessLoanDetail,
  createOwnerPaymentBusinessLoan,
  createOwnerPaymentBusinessLoanRepayment,
  voidOwnerPaymentBusinessLoan,
};
