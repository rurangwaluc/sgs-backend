"use strict";

const {
  createOwnerSupplierBill,
  updateOwnerSupplierBill,
  addOwnerSupplierBillPayment,
  voidOwnerSupplierBill,
} = require("../services/ownerSupplierBillsWriteService");

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

function sendValidationError(reply, parsed, fallback = "Invalid payload") {
  return reply.status(400).send({
    error: fallback,
    details: parsed?.error?.flatten ? parsed.error.flatten() : undefined,
  });
}

function sendServiceError(request, reply, error, logMessage) {
  request.log.error({ err: error }, logMessage);

  if (
    error?.code === "BAD_SUPPLIER_ID" ||
    error?.code === "BAD_LOCATION_ID" ||
    error?.code === "BAD_TOTAL" ||
    error?.code === "BAD_ITEMS" ||
    error?.code === "BAD_BILL_ID" ||
    error?.code === "BAD_AMOUNT" ||
    error?.code === "USE_VOID_ACTION"
  ) {
    return reply.status(400).send({ error: error.message });
  }

  if (
    error?.code === "SUPPLIER_NOT_FOUND" ||
    error?.code === "LOCATION_NOT_FOUND" ||
    error?.code === "NOT_FOUND"
  ) {
    return reply.status(404).send({ error: error.message });
  }

  if (
    error?.code === "VOID_LOCKED" ||
    error?.code === "PAID_EXCEEDS_TOTAL" ||
    error?.code === "ALREADY_PAID" ||
    error?.code === "EXCEEDS_BALANCE" ||
    error?.code === "HAS_PAYMENTS"
  ) {
    return reply.status(409).send({ error: error.message });
  }

  return reply.status(error?.statusCode || 500).send({
    error: error?.message || "Internal Server Error",
  });
}

function getOwnerActor(request) {
  return {
    ownerUserId: toInt(request.user?.id, null),
    ownerLocationId: toInt(request.user?.locationId, null),
  };
}

async function createOwnerSupplierBillHandler(request, reply) {
  try {
    const actor = getOwnerActor(request);

    const result = await createOwnerSupplierBill({
      ...actor,
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
      "createOwnerSupplierBillHandler failed",
    );
  }
}

async function updateOwnerSupplierBillHandler(request, reply) {
  try {
    const billId = toInt(request.params?.id, null);

    if (!billId || billId <= 0) {
      return reply.status(400).send({ error: "Invalid supplier bill id" });
    }

    const actor = getOwnerActor(request);

    const result = await updateOwnerSupplierBill({
      ownerUserId: actor.ownerUserId,
      billId,
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
      "updateOwnerSupplierBillHandler failed",
    );
  }
}

async function addOwnerSupplierBillPaymentHandler(request, reply) {
  try {
    const billId = toInt(request.params?.id, null);

    if (!billId || billId <= 0) {
      return reply.status(400).send({ error: "Invalid supplier bill id" });
    }

    const actor = getOwnerActor(request);

    const result = await addOwnerSupplierBillPayment({
      ownerUserId: actor.ownerUserId,
      billId,
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
      "addOwnerSupplierBillPaymentHandler failed",
    );
  }
}

async function voidOwnerSupplierBillHandler(request, reply) {
  try {
    const billId = toInt(request.params?.id, null);

    if (!billId || billId <= 0) {
      return reply.status(400).send({ error: "Invalid supplier bill id" });
    }

    const actor = getOwnerActor(request);

    const result = await voidOwnerSupplierBill({
      ownerUserId: actor.ownerUserId,
      billId,
      reason: cleanStr(request.body?.reason),
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
      "voidOwnerSupplierBillHandler failed",
    );
  }
}

module.exports = {
  createOwnerSupplierBill: createOwnerSupplierBillHandler,
  updateOwnerSupplierBill: updateOwnerSupplierBillHandler,
  addOwnerSupplierBillPayment: addOwnerSupplierBillPaymentHandler,
  voidOwnerSupplierBill: voidOwnerSupplierBillHandler,
};
