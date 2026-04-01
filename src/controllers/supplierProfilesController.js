"use strict";

const supplierProfilesService = require("../services/supplierProfilesService");
const {
  supplierProfileCreateSchema,
  supplierProfileUpdateSchema,
} = require("../validators/supplierProfiles.schema");

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
    err?.code === "BAD_PROFILE_PAYLOAD" ||
    err?.code === "BAD_ACCEPTED_PAYMENT_METHODS" ||
    err?.code === "BAD_BANK_NAME" ||
    err?.code === "BAD_BANK_ACCOUNT_NAME" ||
    err?.code === "BAD_BANK_ACCOUNT_NUMBER" ||
    err?.code === "BAD_MOMO_NAME" ||
    err?.code === "BAD_MOMO_PHONE" ||
    err?.code === "BAD_PAYMENT_TERMS"
  ) {
    return reply.status(400).send({ error: err.message });
  }

  if (
    err?.code === "SUPPLIER_NOT_FOUND" ||
    err?.code === "SUPPLIER_PROFILE_NOT_FOUND"
  ) {
    return reply.status(404).send({ error: err.message });
  }

  if (err?.code === "SUPPLIER_PROFILE_EXISTS") {
    return reply.status(409).send({ error: err.message });
  }

  return reply.status(500).send({ error: "Internal Server Error" });
}

async function getSupplierProfile(request, reply) {
  const supplierId = toInt(request.params?.supplierId, null);

  if (!supplierId || supplierId <= 0) {
    return reply.status(400).send({ error: "Invalid supplier id" });
  }

  try {
    const profile =
      await supplierProfilesService.getSupplierProfileBySupplierId(supplierId);

    if (!profile) {
      return reply.status(404).send({ error: "Supplier profile not found" });
    }

    return reply.send({
      ok: true,
      profile,
    });
  } catch (err) {
    return handleServiceError(request, reply, err, "getSupplierProfile failed");
  }
}

async function createSupplierProfile(request, reply) {
  const parsed = supplierProfileCreateSchema.safeParse(request.body || {});

  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const profile = await supplierProfilesService.createSupplierProfile(
      parsed.data,
    );

    return reply.status(201).send({
      ok: true,
      profile,
    });
  } catch (err) {
    return handleServiceError(
      request,
      reply,
      err,
      "createSupplierProfile failed",
    );
  }
}

async function updateSupplierProfile(request, reply) {
  const supplierId = toInt(request.params?.supplierId, null);

  if (!supplierId || supplierId <= 0) {
    return reply.status(400).send({ error: "Invalid supplier id" });
  }

  const parsed = supplierProfileUpdateSchema.safeParse(request.body || {});

  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const profile = await supplierProfilesService.updateSupplierProfile({
      supplierId,
      payload: parsed.data,
    });

    return reply.send({
      ok: true,
      profile,
    });
  } catch (err) {
    return handleServiceError(
      request,
      reply,
      err,
      "updateSupplierProfile failed",
    );
  }
}

async function upsertSupplierProfile(request, reply) {
  const supplierId = toInt(request.params?.supplierId, null);

  if (!supplierId || supplierId <= 0) {
    return reply.status(400).send({ error: "Invalid supplier id" });
  }

  const mergedBody = {
    ...(request.body || {}),
    supplierId,
  };

  const parsed = supplierProfileCreateSchema.safeParse(mergedBody);

  if (!parsed.success) {
    return sendValidationError(reply, parsed);
  }

  try {
    const profile = await supplierProfilesService.upsertSupplierProfile(
      parsed.data,
    );

    return reply.send({
      ok: true,
      profile,
    });
  } catch (err) {
    return handleServiceError(
      request,
      reply,
      err,
      "upsertSupplierProfile failed",
    );
  }
}

module.exports = {
  getSupplierProfile,
  createSupplierProfile,
  updateSupplierProfile,
  upsertSupplierProfile,
};
