"use strict";

const {
  createGoodsReceiptSchema,
  listGoodsReceiptsQuerySchema,
} = require("../validators/goodsReceipts.schema");

const goodsReceiptsService = require("../services/goodsReceiptsService");

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function toPositiveInt(value, fallback = null) {
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

function sendValidationError(reply, error, label = "Invalid payload") {
  return reply.status(400).send({
    error: label,
    details: error.flatten(),
  });
}

function sendKnownError(reply, error) {
  if (!error?.code) return false;

  if (
    ["NOT_FOUND", "LOCATION_NOT_FOUND", "SUPPLIER_NOT_FOUND"].includes(
      error.code,
    )
  ) {
    reply.status(404).send({
      error: error.message,
      debug: error.debug || undefined,
    });
    return true;
  }

  if (
    [
      "BAD_LOCATION",
      "BAD_ITEMS",
      "PRODUCT_REQUIRED",
      "OVER_RECEIPT",
      "BAD_USER",
    ].includes(error.code)
  ) {
    reply.status(400).send({
      error: error.message,
      debug: error.debug || undefined,
    });
    return true;
  }

  if (["BAD_STATUS"].includes(error.code)) {
    reply.status(409).send({
      error: error.message,
      debug: error.debug || undefined,
    });
    return true;
  }

  return false;
}

function resolveLocationIdForCreate(request, parsedData) {
  const isOwner = normalizeRole(request.user?.role) === "owner";

  if (isOwner) {
    const pickedLocationId = toPositiveInt(parsedData?.locationId, null);
    if (!pickedLocationId) {
      const err = new Error("Owner must choose a branch");
      err.code = "BAD_LOCATION";
      throw err;
    }
    return pickedLocationId;
  }

  const userLocationId = toPositiveInt(request.user?.locationId, null);
  if (!userLocationId) {
    const err = new Error("Authenticated user has no branch");
    err.code = "BAD_LOCATION";
    throw err;
  }

  return userLocationId;
}

function resolveLocationIdForRead(request, parsedData = {}) {
  const isOwner = normalizeRole(request.user?.role) === "owner";

  if (isOwner) {
    return parsedData?.locationId ?? null;
  }

  const userLocationId = toPositiveInt(request.user?.locationId, null);
  if (!userLocationId) {
    const err = new Error("Authenticated user has no branch");
    err.code = "BAD_LOCATION";
    throw err;
  }

  return userLocationId;
}

async function createGoodsReceipt(request, reply) {
  const parsed = createGoodsReceiptSchema.safeParse(request.body || {});
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
    const out = await goodsReceiptsService.createGoodsReceipt({
      actorUser: request.user,
      locationId: effectiveLocationId,
      purchaseOrderId: parsed.data.purchaseOrderId,
      receiptNo: parsed.data.receiptNo,
      reference: parsed.data.reference,
      note: parsed.data.note,
      receivedAt: parsed.data.receivedAt,
      items: parsed.data.items,
    });

    return reply.send({
      ok: true,
      goodsReceipt: out.goodsReceipt,
      items: out.items,
    });
  } catch (error) {
    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "createGoodsReceipt failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function listGoodsReceipts(request, reply) {
  const parsed = listGoodsReceiptsQuerySchema.safeParse(request.query || {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
  }

  let effectiveLocationId;
  try {
    effectiveLocationId = resolveLocationIdForRead(request, parsed.data);
  } catch (error) {
    if (sendKnownError(reply, error)) return;
    request.log.error({ err: error }, "resolveLocationIdForRead failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }

  try {
    const result = await goodsReceiptsService.listGoodsReceipts({
      locationId: effectiveLocationId,
      purchaseOrderId: parsed.data.purchaseOrderId ?? null,
      supplierId: parsed.data.supplierId ?? null,
      q: parsed.data.q ?? null,
      from: parseIsoDateStart(parsed.data.from),
      toExclusive: parseIsoDateEndExclusive(parsed.data.to),
      limit: parsed.data.limit ?? 50,
      cursor: parsed.data.cursor ?? null,
    });

    return reply.send({
      ok: true,
      goodsReceipts: result.rows,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "listGoodsReceipts failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function getGoodsReceiptById(request, reply) {
  const goodsReceiptId = toPositiveInt(request.params?.id, null);
  if (!goodsReceiptId) {
    return reply.status(400).send({ error: "Invalid goods receipt id" });
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
    const out = await goodsReceiptsService.getGoodsReceiptById({
      goodsReceiptId,
      locationId: effectiveLocationId,
    });

    if (!out) {
      return reply.status(404).send({ error: "Goods receipt not found" });
    }

    return reply.send({
      ok: true,
      goodsReceipt: out.goodsReceipt,
      items: out.items,
    });
  } catch (error) {
    if (sendKnownError(reply, error)) return;

    request.log.error({ err: error }, "getGoodsReceiptById failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

module.exports = {
  createGoodsReceipt,
  listGoodsReceipts,
  getGoodsReceiptById,
};
