"use strict";

const ownerSuppliersService = require("../services/ownerSuppliersService");

function toInt(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function handleServiceError(req, reply, error, logMessage) {
  req.log.error({ err: error }, logMessage);

  if (error?.code === "BAD_SUPPLIER_ID" || error?.code === "BAD_LOCATION_ID") {
    return reply.status(400).send({ error: error.message });
  }

  if (error?.code === "SUPPLIER_NOT_FOUND") {
    return reply.status(404).send({ error: error.message });
  }

  return reply.status(500).send({ error: "Internal Server Error" });
}

function buildFilters(query = {}) {
  return {
    q: query.q,
    locationId: query.locationId,
    sourceType: query.sourceType,
    active: query.active,
    status: query.status,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    limit: query.limit,
    offset: query.offset,
  };
}

async function getOwnerSuppliersSummary(req, reply) {
  try {
    const summary = await ownerSuppliersService.getOwnerSuppliersSummary(
      buildFilters(req.query || {}),
    );

    return reply.send({
      ok: true,
      summary,
    });
  } catch (error) {
    return handleServiceError(
      req,
      reply,
      error,
      "getOwnerSuppliersSummary failed",
    );
  }
}

async function listOwnerSuppliers(req, reply) {
  try {
    const rows = await ownerSuppliersService.listOwnerSuppliers(
      buildFilters(req.query || {}),
    );

    return reply.send({
      ok: true,
      suppliers: rows,
    });
  } catch (error) {
    return handleServiceError(req, reply, error, "listOwnerSuppliers failed");
  }
}

async function getOwnerSupplier(req, reply) {
  const id = toInt(req.params?.id, null);
  if (!id || id <= 0) {
    return reply.status(400).send({ error: "Invalid supplier id" });
  }

  try {
    const detail = await ownerSuppliersService.getOwnerSupplierById({
      id,
      locationId: req.query?.locationId,
      dateFrom: req.query?.dateFrom,
      dateTo: req.query?.dateTo,
    });

    if (!detail?.supplier) {
      return reply.status(404).send({ error: "Supplier not found" });
    }

    return reply.send({
      ok: true,
      supplier: detail.supplier,
      profile: detail.profile,
      evaluation: detail.evaluation,
    });
  } catch (error) {
    return handleServiceError(req, reply, error, "getOwnerSupplier failed");
  }
}

module.exports = {
  getOwnerSuppliersSummary,
  listOwnerSuppliers,
  getOwnerSupplier,
};
