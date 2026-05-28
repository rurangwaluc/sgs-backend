"use strict";

const {
  listOwnerLoans,
  getOwnerLoan,
  createOwnerLoan,
  updateOwnerLoan,
  createOwnerLoanRepayment,
  voidOwnerLoan,
  ownerLoanSummary,
} = require("../services/ownerLoansService");

function toInt(v, def = null) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || "";
}

function resolveScopedLocationId(request) {
  const queryLocationId = toInt(request.query?.locationId, null);
  const bodyLocationId = toInt(request.body?.locationId, null);
  const userLocationId = toInt(request.user?.locationId, null);

  return queryLocationId || bodyLocationId || userLocationId || null;
}

function sanitizeErrorMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return undefined;
  }

  const out = {};

  if (meta.availableBalance != null) {
    const n = Number(meta.availableBalance);
    if (Number.isFinite(n)) out.availableBalance = Math.trunc(n);
  }

  if (meta.requestedAmount != null) {
    const n = Number(meta.requestedAmount);
    if (Number.isFinite(n)) out.requestedAmount = Math.trunc(n);
  }

  if (meta.locationId != null) {
    const n = Number(meta.locationId);
    if (Number.isFinite(n)) out.locationId = Math.trunc(n);
  }

  if (meta.method != null) {
    out.method = String(meta.method).trim().toUpperCase();
  }

  if (meta.currency != null) {
    out.currency = String(meta.currency).trim().toUpperCase();
  }

  if (meta.code != null) {
    out.code = String(meta.code).trim().toUpperCase();
  }

  return Object.keys(out).length ? out : undefined;
}

function sendServiceError(request, reply, error, logMessage) {
  request.log.error({ err: error }, logMessage);

  const status = Number(error?.statusCode || 500);
  const meta = sanitizeErrorMeta(error?.meta);

  return reply.status(status).send({
    ok: false,
    error: error?.message || "Internal Server Error",
    ...(meta ? { meta } : {}),
  });
}

async function listOwnerLoansHandler(request, reply) {
  try {
    const loans = await listOwnerLoans({
      actorUser: request.user || null,
      locationId: resolveScopedLocationId(request),
      q: cleanStr(request.query?.q),
      customerId: toInt(request.query?.customerId, null),
      receiverType: cleanStr(request.query?.receiverType),
      status: cleanStr(request.query?.status),
      dueFrom: cleanStr(request.query?.dueFrom),
      dueTo: cleanStr(request.query?.dueTo),
      disbursedFrom: cleanStr(request.query?.disbursedFrom),
      disbursedTo: cleanStr(request.query?.disbursedTo),
      limit: Math.max(1, Math.min(100, toInt(request.query?.limit, 50) || 50)),
      offset: Math.max(0, toInt(request.query?.offset, 0) || 0),
    });

    return reply.send({
      ok: true,
      loans,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "listOwnerLoansHandler failed",
    );
  }
}

async function getOwnerLoanHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid owner loan id",
      });
    }

    const result = await getOwnerLoan({
      id,
      actorUser: request.user || null,
      locationId: resolveScopedLocationId(request),
    });

    return reply.send({
      ok: true,
      ...result,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "getOwnerLoanHandler failed",
    );
  }
}

async function createOwnerLoanHandler(request, reply) {
  try {
    const loan = await createOwnerLoan({
      actorUser: request.user || null,
      payload: request.body || {},
    });

    return reply.status(201).send({
      ok: true,
      loan,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "createOwnerLoanHandler failed",
    );
  }
}

async function updateOwnerLoanHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid owner loan id",
      });
    }

    const loan = await updateOwnerLoan({
      id,
      actorUser: request.user || null,
      payload: request.body || {},
    });

    return reply.send({
      ok: true,
      loan,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "updateOwnerLoanHandler failed",
    );
  }
}

async function createOwnerLoanRepaymentHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid owner loan id",
      });
    }

    const result = await createOwnerLoanRepayment({
      id,
      actorUser: request.user || null,
      payload: request.body || {},
    });

    return reply.status(201).send({
      ok: true,
      ...result,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "createOwnerLoanRepaymentHandler failed",
    );
  }
}

async function voidOwnerLoanHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid owner loan id",
      });
    }

    const result = await voidOwnerLoan({
      id,
      actorUser: request.user || null,
      payload: request.body || {},
    });

    return reply.send({
      ok: true,
      ...result,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "voidOwnerLoanHandler failed",
    );
  }
}

async function ownerLoanSummaryHandler(request, reply) {
  try {
    const summary = await ownerLoanSummary({
      actorUser: request.user || null,
      locationId: resolveScopedLocationId(request),
      status: cleanStr(request.query?.status),
      receiverType: cleanStr(request.query?.receiverType),
    });

    return reply.send({
      ok: true,
      summary,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "ownerLoanSummaryHandler failed",
    );
  }
}

module.exports = {
  listOwnerLoans: listOwnerLoansHandler,
  getOwnerLoan: getOwnerLoanHandler,
  createOwnerLoan: createOwnerLoanHandler,
  updateOwnerLoan: updateOwnerLoanHandler,
  createOwnerLoanRepayment: createOwnerLoanRepaymentHandler,
  voidOwnerLoan: voidOwnerLoanHandler,
  ownerLoanSummary: ownerLoanSummaryHandler,
};
