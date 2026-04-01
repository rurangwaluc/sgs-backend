"use strict";

const supplierEvaluationsService = require("../services/supplierEvaluationsService");
const {
  supplierEvaluationCreateSchema,
  supplierEvaluationUpdateSchema,
} = require("../validators/supplierEvaluations.schema");

function toInt(v, dflt = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

function sendValidationError(reply, parsed, fallback = "Invalid payload") {
  return reply.status(400).send({
    error: fallback,
    details:
      typeof parsed?.error?.flatten === "function"
        ? parsed.error.flatten()
        : parsed?.error || null,
  });
}

function handleServiceError(
  request,
  reply,
  err,
  fallbackLog = "Request failed",
) {
  request.log.error({ err }, fallbackLog);

  if (
    err?.code === "BAD_SUPPLIER_ID" ||
    err?.code === "BAD_RATING" ||
    err?.code === "BAD_ISSUE_COUNT" ||
    err?.code === "BAD_DATE" ||
    err?.code === "BAD_RISK_LEVEL"
  ) {
    return reply.status(400).send({ error: err.message });
  }

  if (
    err?.code === "SUPPLIER_NOT_FOUND" ||
    err?.code === "SUPPLIER_EVALUATION_NOT_FOUND"
  ) {
    return reply.status(404).send({ error: err.message });
  }

  if (err?.code === "SUPPLIER_EVALUATION_EXISTS") {
    return reply.status(409).send({ error: err.message });
  }

  return reply.status(500).send({ error: "Internal Server Error" });
}

async function getSupplierEvaluation(request, reply) {
  const supplierId = toInt(request.params?.supplierId, null);

  if (!supplierId || supplierId <= 0) {
    return reply.status(400).send({ error: "Invalid supplier id" });
  }

  try {
    const evaluation =
      await supplierEvaluationsService.getSupplierEvaluationBySupplierId(
        supplierId,
      );

    if (!evaluation) {
      return reply.status(404).send({ error: "Supplier evaluation not found" });
    }

    return reply.send({
      ok: true,
      evaluation,
    });
  } catch (err) {
    return handleServiceError(
      request,
      reply,
      err,
      "getSupplierEvaluation failed",
    );
  }
}

async function createSupplierEvaluation(request, reply) {
  const parsed = supplierEvaluationCreateSchema.safeParse(request.body || {});

  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const evaluation =
      await supplierEvaluationsService.createSupplierEvaluation(parsed.data);

    return reply.status(201).send({
      ok: true,
      evaluation,
    });
  } catch (err) {
    return handleServiceError(
      request,
      reply,
      err,
      "createSupplierEvaluation failed",
    );
  }
}

async function updateSupplierEvaluation(request, reply) {
  const supplierId = toInt(request.params?.supplierId, null);

  if (!supplierId || supplierId <= 0) {
    return reply.status(400).send({ error: "Invalid supplier id" });
  }

  const parsed = supplierEvaluationUpdateSchema.safeParse(request.body || {});

  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const evaluation =
      await supplierEvaluationsService.updateSupplierEvaluation({
        supplierId,
        payload: parsed.data,
      });

    return reply.send({
      ok: true,
      evaluation,
    });
  } catch (err) {
    return handleServiceError(
      request,
      reply,
      err,
      "updateSupplierEvaluation failed",
    );
  }
}

async function upsertSupplierEvaluation(request, reply) {
  const supplierId = toInt(request.params?.supplierId, null);

  if (!supplierId || supplierId <= 0) {
    return reply.status(400).send({ error: "Invalid supplier id" });
  }

  const mergedBody = {
    ...(request.body || {}),
    supplierId,
  };

  const parsed = supplierEvaluationCreateSchema.safeParse(mergedBody);

  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const evaluation =
      await supplierEvaluationsService.upsertSupplierEvaluation(parsed.data);

    return reply.send({
      ok: true,
      evaluation,
    });
  } catch (err) {
    return handleServiceError(
      request,
      reply,
      err,
      "upsertSupplierEvaluation failed",
    );
  }
}

module.exports = {
  getSupplierEvaluation,
  createSupplierEvaluation,
  updateSupplierEvaluation,
  upsertSupplierEvaluation,
};
