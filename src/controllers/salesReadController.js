"use strict";

const ROLES = require("../permissions/roles");
const salesReadService = require("../services/salesReadService");

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;

  const v = String(value ?? "")
    .trim()
    .toLowerCase();

  if (["true", "yes", "y", "on"].includes(v)) return true;
  if (["false", "no", "n", "off"].includes(v)) return false;

  return fallback;
}

async function getSale(request, reply) {
  const saleId = toInt(request.params?.id, null);

  if (!saleId || saleId <= 0) {
    return reply.status(400).send({ error: "Invalid sale id" });
  }

  const sale = await salesReadService.getSaleById({
    locationId: request.user.locationId,
    saleId,
  });

  if (!sale) {
    return reply.status(404).send({ error: "Sale not found" });
  }

  if (request.user.role === ROLES.SELLER && sale.sellerId !== request.user.id) {
    return reply.status(403).send({ error: "Forbidden" });
  }

  return reply.send({ ok: true, sale });
}

async function listSales(request, reply) {
  const filters = {
    status: request.query?.status || null,
    sellerId: request.query?.sellerId || null,
    q: request.query?.q || null,
    dateFrom: request.query?.dateFrom || null,
    dateTo: request.query?.dateTo || null,
    limit: request.query?.limit || 200,

    stuck: toBool(request.query?.stuck, false),
    stuckOlderThanMinutes: toInt(request.query?.stuckOlderThanMinutes, 30),
  };

  if (request.user.role === ROLES.SELLER) {
    filters.sellerId = request.user.id;
  }

  const sales = await salesReadService.listSales({
    locationId: request.user.locationId,
    filters,
  });

  return reply.send({ ok: true, sales });
}

module.exports = { getSale, listSales };
