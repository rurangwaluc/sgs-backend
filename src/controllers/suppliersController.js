"use strict";

const {
  listSuppliers,
  createSupplier,
  getSupplier,
  updateSupplier,
  deleteSupplier,
  supplierSummary,
} = require("../services/suppliersService");

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function parseBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return undefined;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || "";
}

function sendError(request, reply, error, logMessage) {
  request.log.error({ err: error }, logMessage);

  const status = Number(error?.statusCode || 500);
  return reply.status(status).send({
    error: error?.message || "Internal Server Error",
  });
}

async function listSuppliersHandler(request, reply) {
  try {
    const suppliers = await listSuppliers({
      q: cleanStr(request.query?.q),
      limit: Math.max(1, Math.min(100, toInt(request.query?.limit, 50) || 50)),
      offset: Math.max(0, toInt(request.query?.offset, 0) || 0),
      active: parseBool(request.query?.active),
      sourceType: cleanStr(request.query?.sourceType) || undefined,
    });

    return reply.send({
      ok: true,
      suppliers,
    });
  } catch (error) {
    return sendError(request, reply, error, "listSuppliersHandler failed");
  }
}

async function createSupplierHandler(request, reply) {
  try {
    const supplier = await createSupplier({
      actorUser: request.user || null,
      payload: request.body || {},
    });

    return reply.status(201).send({
      ok: true,
      supplier,
    });
  } catch (error) {
    return sendError(request, reply, error, "createSupplierHandler failed");
  }
}

async function getSupplierHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier id" });
    }

    const supplier = await getSupplier({ id });

    return reply.send({
      ok: true,
      supplier,
    });
  } catch (error) {
    return sendError(request, reply, error, "getSupplierHandler failed");
  }
}

async function updateSupplierHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier id" });
    }

    const supplier = await updateSupplier({
      id,
      actorUser: request.user || null,
      payload: request.body || {},
    });

    return reply.send({
      ok: true,
      supplier,
    });
  } catch (error) {
    return sendError(request, reply, error, "updateSupplierHandler failed");
  }
}

async function deleteSupplierHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier id" });
    }

    const supplier = await deleteSupplier({
      id,
      actorUser: request.user || null,
    });

    return reply.send({
      ok: true,
      supplier,
    });
  } catch (error) {
    return sendError(request, reply, error, "deleteSupplierHandler failed");
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
    return sendError(request, reply, error, "supplierSummaryHandler failed");
  }
}

module.exports = {
  listSuppliers: listSuppliersHandler,
  createSupplier: createSupplierHandler,
  getSupplier: getSupplierHandler,
  updateSupplier: updateSupplierHandler,
  deleteSupplier: deleteSupplierHandler,
  supplierSummary: supplierSummaryHandler,
};
