"use strict";

const {
  listOwnerSupplierBills,
  getOwnerSupplierBillsSummary,
  getOwnerSupplierBillById,
} = require("../services/ownerSupplierBillsService");

function toInt(v, dflt = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
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

async function listOwnerSupplierBillsHandler(request, reply) {
  try {
    const bills = await listOwnerSupplierBills({
      locationId: toInt(request.query?.locationId, null),
      supplierId: toInt(request.query?.supplierId, null),
      status: cleanStr(request.query?.status),
      q: cleanStr(request.query?.q),
      limit: Math.max(
        1,
        Math.min(200, toInt(request.query?.limit, 100) || 100),
      ),
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
      "listOwnerSupplierBillsHandler failed",
    );
  }
}

async function ownerSupplierBillsSummaryHandler(request, reply) {
  try {
    const summary = await getOwnerSupplierBillsSummary({
      locationId: toInt(request.query?.locationId, null),
      supplierId: toInt(request.query?.supplierId, null),
      status: cleanStr(request.query?.status),
      q: cleanStr(request.query?.q),
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
      "ownerSupplierBillsSummaryHandler failed",
    );
  }
}

async function getOwnerSupplierBillHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier bill id" });
    }

    const result = await getOwnerSupplierBillById(id);
    if (!result) {
      return reply.status(404).send({ error: "Supplier bill not found" });
    }

    return reply.send({
      ok: true,
      ...result,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "getOwnerSupplierBillHandler failed",
    );
  }
}

module.exports = {
  listOwnerSupplierBills: listOwnerSupplierBillsHandler,
  ownerSupplierBillsSummary: ownerSupplierBillsSummaryHandler,
  getOwnerSupplierBill: getOwnerSupplierBillHandler,
};
