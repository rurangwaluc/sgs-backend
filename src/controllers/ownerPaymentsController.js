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
    dateFrom: normalizeDate(query.dateFrom || query.from),
    dateTo: normalizeDate(query.dateTo || query.to),
    limit: toPositiveInt(query.limit, 50),
    offset: toNonNegativeInt(query.offset, 0),
  };
}

async function listOwnerPayments(request, reply) {
  try {
    const filters = buildFilters(request.query || {});

    const rows = await ownerPaymentsService.listOwnerPayments({
      locationId: filters.locationId,
      method: filters.method,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      limit: filters.limit,
      offset: filters.offset,
    });

    return reply.send({
      ok: true,
      payments: rows,
      movements: rows, // clearer name for new frontend, kept alongside old key
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        count: Array.isArray(rows) ? rows.length : 0,
      },
      filters: {
        locationId: filters.locationId ?? null,
        method: filters.method ?? null,
        dateFrom: filters.dateFrom ?? null,
        dateTo: filters.dateTo ?? null,
      },
    });
  } catch (e) {
    request.log.error({ err: e }, "listOwnerPayments failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function getOwnerPaymentsSummary(request, reply) {
  try {
    const filters = buildFilters(request.query || {});

    const summary = await ownerPaymentsService.getOwnerPaymentsSummary({
      locationId: filters.locationId,
      method: filters.method,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return reply.send({
      ok: true,
      summary,
      filters: {
        locationId: filters.locationId ?? null,
        method: filters.method ?? null,
        dateFrom: filters.dateFrom ?? null,
        dateTo: filters.dateTo ?? null,
      },
    });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerPaymentsSummary failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function getOwnerPaymentsBreakdown(request, reply) {
  try {
    const filters = buildFilters(request.query || {});

    const breakdown = await ownerPaymentsService.getOwnerPaymentsBreakdown({
      locationId: filters.locationId,
      method: filters.method,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return reply.send({
      ok: true,
      breakdown,
      filters: {
        locationId: filters.locationId ?? null,
        method: filters.method ?? null,
        dateFrom: filters.dateFrom ?? null,
        dateTo: filters.dateTo ?? null,
      },
    });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerPaymentsBreakdown failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

module.exports = {
  listOwnerPayments,
  getOwnerPaymentsSummary,
  getOwnerPaymentsBreakdown,
};
