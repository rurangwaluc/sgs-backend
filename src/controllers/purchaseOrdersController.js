"use strict";

const {
  createPurchaseOrderSchema,
  updatePurchaseOrderSchema,
  approvePurchaseOrderSchema,
  cancelPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
} = require("../validators/purchaseorders.schema");

const purchaseOrdersService = require("../services/purchaseOrdersService");

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function parsePositiveInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseIsoDateStart(value) {
  const s = String(value || "").trim();
  if (!s) return null;

  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseIsoDateEndExclusive(value) {
  const s = String(value || "").trim();
  if (!s) return null;

  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;

  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function extractErrorMessage(error, fallback = "Internal Server Error") {
  return error?.message || fallback;
}

function sendValidationError(reply, error, label = "Invalid payload") {
  return reply.status(400).send({
    error: label,
    details: error.flatten(),
  });
}

function sendKnownError(reply, error) {
  if (!error?.code) return false;

  if (
    [
      "LOCATION_NOT_FOUND",
      "SUPPLIER_NOT_FOUND",
      "PRODUCT_NOT_FOUND",
      "NOT_FOUND",
    ].includes(error.code)
  ) {
    reply.status(404).send({
      error: extractErrorMessage(error),
      debug: error.debug || undefined,
    });
    return true;
  }

  if (
    [
      "PRODUCT_ARCHIVED",
      "BAD_ITEMS",
      "BAD_LOCATION",
      "BAD_SUPPLIER",
      "BAD_CURRENCY",
      "BAD_DATE",
      "BAD_STATUS",
      "LINES_LOCKED",
      "STATUS_LOCKED",
    ].includes(error.code)
  ) {
    reply.status(400).send({
      error: extractErrorMessage(error),
      debug: error.debug || undefined,
    });
    return true;
  }

  if (["HAS_RECEIPTS"].includes(error.code)) {
    reply.status(409).send({
      error: extractErrorMessage(error),
      debug: error.debug || undefined,
    });
    return true;
  }

  return false;
}

function requireOwnerLocationId(request, parsedData) {
  const role = normalizeRole(request.user?.role);
  if (role !== "owner") return request.user?.locationId || null;

  const locationId = parsePositiveInt(parsedData?.locationId, null);
  return locationId;
}

function resolveLocationIdForCreate(request, parsedData) {
  const role = normalizeRole(request.user?.role);

  if (role === "owner") {
    const locationId = parsePositiveInt(parsedData?.locationId, null);
    if (!locationId) {
      const err = new Error("Owner must choose a branch");
      err.code = "BAD_LOCATION";
      throw err;
    }
    return locationId;
  }

  const locationId = parsePositiveInt(request.user?.locationId, null);
  if (!locationId) {
    const err = new Error("Authenticated user has no branch");
    err.code = "BAD_LOCATION";
    throw err;
  }

  return locationId;
}

function resolveLocationIdForList(request, parsedData) {
  const role = normalizeRole(request.user?.role);

  if (role === "owner") {
    return parsedData?.locationId ?? null;
  }

  const locationId = parsePositiveInt(request.user?.locationId, null);
  if (!locationId) {
    const err = new Error("Authenticated user has no branch");
    err.code = "BAD_LOCATION";
    throw err;
  }

  return locationId;
}

function resolveLocationIdForRead(request) {
  const role = normalizeRole(request.user?.role);

  if (role === "owner") return null;

  const locationId = parsePositiveInt(request.user?.locationId, null);
  if (!locationId) {
    const err = new Error("Authenticated user has no branch");
    err.code = "BAD_LOCATION";
    throw err;
  }

  return locationId;
}

async function createPurchaseOrder(request, reply) {
  const parsed = createPurchaseOrderSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return sendValidationError(reply, parsed.error, "Invalid payload");
  }

  let effectiveLocationId;
  try {
    effectiveLocationId = resolveLocationIdForCreate(request, parsed.data);
  } catch (error) {
    if (sendKnownError(reply, error)) return;
    request.log.error({ err: error }, "resolveLocationIdForCreate failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }

  try {
    const out = await purchaseOrdersService.createPurchaseOrder({
      actorUser: request.user,
      locationId: effectiveLocationId,
      supplierId: parsed.data.supplierId,
      poNo: parsed.data.poNo,
      reference: parsed.data.reference,
      currency: parsed.data.currency,
      notes: parsed.data.notes,
      orderedAt: parsed.data.orderedAt,
      expectedAt: parsed.data.expectedAt,
      items: parsed.data.items,
    });

    return reply.send({
      ok: true,
      purchaseOrder: out.purchaseOrder,
      items: out.items,
    });
  } catch (error) {
    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "createPurchaseOrder failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function updatePurchaseOrder(request, reply) {
  const purchaseOrderId = parsePositiveInt(request.params?.id, null);
  if (!purchaseOrderId) {
    return reply.status(400).send({ error: "Invalid purchase order id" });
  }

  const parsed = updatePurchaseOrderSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return sendValidationError(reply, parsed.error, "Invalid payload");
  }

  try {
    const out = await purchaseOrdersService.updatePurchaseOrder({
      actorUser: request.user,
      purchaseOrderId,
      supplierId: parsed.data.supplierId,
      poNo: parsed.data.poNo,
      reference: parsed.data.reference,
      currency: parsed.data.currency,
      notes: parsed.data.notes,
      orderedAt: parsed.data.orderedAt,
      expectedAt: parsed.data.expectedAt,
      items: parsed.data.items,
    });

    return reply.send({
      ok: true,
      purchaseOrder: out.purchaseOrder,
      items: out.items,
    });
  } catch (error) {
    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "updatePurchaseOrder failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function approvePurchaseOrder(request, reply) {
  const purchaseOrderId = parsePositiveInt(request.params?.id, null);
  if (!purchaseOrderId) {
    return reply.status(400).send({ error: "Invalid purchase order id" });
  }

  const parsed = approvePurchaseOrderSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return sendValidationError(reply, parsed.error, "Invalid payload");
  }

  try {
    const out = await purchaseOrdersService.approvePurchaseOrder({
      actorUser: request.user,
      purchaseOrderId,
    });

    return reply.send({
      ok: true,
      purchaseOrder: out.purchaseOrder,
      items: out.items,
    });
  } catch (error) {
    if (error?.code === "BAD_STATUS") {
      return reply.status(409).send({ error: extractErrorMessage(error) });
    }

    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "approvePurchaseOrder failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function cancelPurchaseOrder(request, reply) {
  const purchaseOrderId = parsePositiveInt(request.params?.id, null);
  if (!purchaseOrderId) {
    return reply.status(400).send({ error: "Invalid purchase order id" });
  }

  const parsed = cancelPurchaseOrderSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return sendValidationError(reply, parsed.error, "Invalid payload");
  }

  try {
    const out = await purchaseOrdersService.cancelPurchaseOrder({
      actorUser: request.user,
      purchaseOrderId,
      reason: parsed.data.reason,
    });

    return reply.send({
      ok: true,
      purchaseOrder: out.purchaseOrder,
      items: out.items,
    });
  } catch (error) {
    if (error?.code === "BAD_STATUS" || error?.code === "HAS_RECEIPTS") {
      return reply.status(409).send({ error: extractErrorMessage(error) });
    }

    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "cancelPurchaseOrder failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function listPurchaseOrders(request, reply) {
  const parsed = listPurchaseOrdersQuerySchema.safeParse(request.query || {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
  }

  let effectiveLocationId;
  try {
    effectiveLocationId = resolveLocationIdForList(request, parsed.data);
  } catch (error) {
    if (sendKnownError(reply, error)) return;
    request.log.error({ err: error }, "resolveLocationIdForList failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }

  try {
    const result = await purchaseOrdersService.listPurchaseOrders({
      locationId: effectiveLocationId,
      supplierId: parsed.data.supplierId ?? null,
      status: parsed.data.status ?? null,
      q: parsed.data.q ?? null,
      from: parseIsoDateStart(parsed.data.from),
      toExclusive: parseIsoDateEndExclusive(parsed.data.to),
      limit: parsed.data.limit ?? 50,
      cursor: parsed.data.cursor ?? null,
    });

    return reply.send({
      ok: true,
      purchaseOrders: result.rows,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "listPurchaseOrders failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function getPurchaseOrderById(request, reply) {
  const purchaseOrderId = parsePositiveInt(request.params?.id, null);
  if (!purchaseOrderId) {
    return reply.status(400).send({ error: "Invalid purchase order id" });
  }

  let effectiveLocationId;
  try {
    effectiveLocationId = resolveLocationIdForRead(request);
  } catch (error) {
    if (sendKnownError(reply, error)) return;
    request.log.error({ err: error }, "resolveLocationIdForRead failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }

  try {
    const out = await purchaseOrdersService.getPurchaseOrderById({
      purchaseOrderId,
      locationId: effectiveLocationId,
    });

    if (!out) {
      return reply.status(404).send({ error: "Purchase order not found" });
    }

    return reply.send({
      ok: true,
      purchaseOrder: out.purchaseOrder,
      items: out.items,
    });
  } catch (error) {
    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "getPurchaseOrderById failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

module.exports = {
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrderById,
};
