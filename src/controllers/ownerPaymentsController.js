"use strict";

const ownerPaymentsService = require("../services/ownerPaymentsService");

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const x = Math.trunc(n);
  if (x <= 0) return fallback;
  return x;
}

function toNonNegativeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const x = Math.trunc(n);
  if (x < 0) return fallback;
  return x;
}

function cleanText(value, max = 100) {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

function normalizeMethod(value) {
  const s = String(value || "")
    .trim()
    .toUpperCase();
  if (["CASH", "MOMO", "BANK", "CARD", "OTHER"].includes(s)) return s;
  return undefined;
}

function normalizeDate(value) {
  const s = cleanText(value, 40);
  if (!s) return undefined;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return undefined;
  return s;
}

function normalizeLocationId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const x = Math.trunc(n);
  if (x <= 0) return undefined;
  return x;
}

function buildFilters(query = {}) {
  return {
    locationId: normalizeLocationId(query.locationId),
    method: normalizeMethod(query.method),
    status: cleanText(query.status, 40),
    q: cleanText(query.q, 160),
    dateFrom: normalizeDate(query.dateFrom || query.from),
    dateTo: normalizeDate(query.dateTo || query.to),
    limit: toPositiveInt(query.limit, 50),
    offset: toNonNegativeInt(query.offset, 0),
  };
}

function actorId(request) {
  return Number(
    request.user?.id || request.authUser?.id || request.me?.id || 0,
  );
}

async function listOwnerPayments(request, reply) {
  try {
    const filters = buildFilters(request.query || {});
    const rows = await ownerPaymentsService.listOwnerPayments(filters);

    return reply.send({
      ok: true,
      payments: rows,
      movements: rows,
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        count: Array.isArray(rows) ? rows.length : 0,
      },
      filters,
    });
  } catch (e) {
    request.log.error({ err: e }, "listOwnerPayments failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function getOwnerPaymentsSummary(request, reply) {
  try {
    const filters = buildFilters(request.query || {});
    const summary = await ownerPaymentsService.getOwnerPaymentsSummary(filters);
    return reply.send({ ok: true, summary, filters });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerPaymentsSummary failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function getOwnerPaymentsBreakdown(request, reply) {
  try {
    const filters = buildFilters(request.query || {});
    const breakdown =
      await ownerPaymentsService.getOwnerPaymentsBreakdown(filters);
    return reply.send({ ok: true, breakdown, filters });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerPaymentsBreakdown failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function listOwnerLoans(request, reply) {
  try {
    const filters = buildFilters(request.query || {});
    const result = await ownerPaymentsService.listOwnerLoans(filters);

    return reply.send({
      ok: true,
      loans: result.rows,
      rows: result.rows,
      summary: result.summary,
      pagination: result.pagination,
      filters,
    });
  } catch (e) {
    request.log.error({ err: e }, "listOwnerLoans failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function voidOwnerLoan(request, reply) {
  try {
    const id = toPositiveInt(request.params?.id, null);
    const reason = cleanText(request.body?.reason, 300);

    const result = await ownerPaymentsService.voidOwnerLoan({
      loanId: id,
      actorUserId: actorId(request),
      reason,
    });

    return reply.send({
      ok: true,
      message: "Owner loan voided",
      loan: result,
    });
  } catch (e) {
    if (["BAD_LOAN_ID", "BAD_ACTOR", "BAD_VOID_REASON"].includes(e.code)) {
      return reply.status(400).send({ ok: false, error: e.message });
    }

    if (e.code === "OWNER_LOAN_NOT_FOUND") {
      return reply.status(404).send({ ok: false, error: e.message });
    }

    if (e.code === "OWNER_LOAN_NOT_VOIDABLE") {
      return reply.status(409).send({ ok: false, error: e.message });
    }

    request.log.error({ err: e }, "voidOwnerLoan failed");
    return reply
      .status(500)
      .send({ ok: false, error: "Internal Server Error" });
  }
}

module.exports = {
  listOwnerPayments,
  getOwnerPaymentsSummary,
  getOwnerPaymentsBreakdown,
  listOwnerLoans,
  voidOwnerLoan,
};
