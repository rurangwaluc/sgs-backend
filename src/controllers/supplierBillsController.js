"use strict";

const {
  listSupplierBills,
  getSupplierBill,
  createSupplierBill,
  updateSupplierBill,
  deleteSupplierBill,
  createSupplierBillPayment,
  supplierSummary,
} = require("../services/supplierBillsService");

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || "";
}

function sendServiceError(request, reply, error, logMessage) {
  request.log.error({ err: error }, logMessage);

  const status = Number(error?.statusCode || 500);
  return reply.status(status).send({
    error: error?.message || "Internal Server Error",
  });
}

async function listSupplierBillsHandler(request, reply) {
  try {
    const bills = await listSupplierBills({
      locationId: toInt(request.user?.locationId, null),
      q: cleanStr(request.query?.q),
      supplierId: toInt(request.query?.supplierId, null),
      status: cleanStr(request.query?.status),
      limit: Math.max(1, Math.min(100, toInt(request.query?.limit, 50) || 50)),
      offset: Math.max(0, toInt(request.query?.offset, 0) || 0),
    });

    return reply.send({
      ok: true,
      bills,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "listSupplierBillsHandler failed",
    );
  }
}

async function getSupplierBillHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier bill id" });
    }

    const result = await getSupplierBill({
      id,
      locationId: toInt(request.user?.locationId, null),
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
      "getSupplierBillHandler failed",
    );
  }
}

async function createSupplierBillHandler(request, reply) {
  try {
    const bill = await createSupplierBill({
      actorUser: request.user || null,
      payload: request.body || {},
    });

    return reply.status(201).send({
      ok: true,
      bill,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "createSupplierBillHandler failed",
    );
  }
}

async function updateSupplierBillHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier bill id" });
    }

    const bill = await updateSupplierBill({
      id,
      actorUser: request.user || null,
      payload: request.body || {},
    });

    return reply.send({
      ok: true,
      bill,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "updateSupplierBillHandler failed",
    );
  }
}

async function deleteSupplierBillHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier bill id" });
    }

    const result = await deleteSupplierBill({
      id,
      actorUser: request.user || null,
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
      "deleteSupplierBillHandler failed",
    );
  }
}

async function createSupplierBillPaymentHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier bill id" });
    }

    const result = await createSupplierBillPayment({
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
      "createSupplierBillPaymentHandler failed",
    );
  }
}

async function supplierSummaryHandler(request, reply) {
  try {
    const summary = await supplierSummary({
      locationId: toInt(request.user?.locationId, null),
      supplierId: toInt(request.query?.supplierId, null),
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
      "supplierSummaryHandler failed",
    );
  }
}

module.exports = {
  listSupplierBills: listSupplierBillsHandler,
  getSupplierBill: getSupplierBillHandler,
  createSupplierBill: createSupplierBillHandler,
  updateSupplierBill: updateSupplierBillHandler,
  deleteSupplierBill: deleteSupplierBillHandler,
  createSupplierBillPayment: createSupplierBillPaymentHandler,
  supplierSummary: supplierSummaryHandler,
};
