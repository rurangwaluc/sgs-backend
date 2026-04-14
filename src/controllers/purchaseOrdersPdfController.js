"use strict";

const {
  buildPurchaseOrderPdfBuffer,
} = require("../services/purchaseOrderPdfService");

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function toInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;

  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "download"].includes(s)) return true;
  if (["0", "false", "no", "n", "inline"].includes(s)) return false;
  return fallback;
}

function safeFileName(value, fallback = "purchase-order.pdf") {
  const raw = String(value || fallback).trim() || fallback;
  const cleaned = raw.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");

  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
}

async function getPurchaseOrderPdf(request, reply) {
  const purchaseOrderId = toInt(request.params?.id, null);
  if (!purchaseOrderId || purchaseOrderId <= 0) {
    return reply.status(400).send({ error: "Invalid purchase order id" });
  }

  const isOwner = normalizeRole(request.user?.role) === "owner";
  const effectiveLocationId = isOwner
    ? null
    : toInt(request.user?.locationId, null);

  if (!isOwner && (!effectiveLocationId || effectiveLocationId <= 0)) {
    return reply.status(400).send({ error: "Invalid user location scope" });
  }

  try {
    const result = await buildPurchaseOrderPdfBuffer({
      purchaseOrderId,
      locationId: effectiveLocationId,
    });

    const fileName = safeFileName(
      result?.fileName ||
        result?.data?.purchaseOrder?.poNo ||
        `purchase-order-${purchaseOrderId}.pdf`,
      `purchase-order-${purchaseOrderId}.pdf`,
    );

    const forceDownload = toBool(request.query?.download, false);
    const disposition = forceDownload ? "attachment" : "inline";

    reply.header("Content-Type", result?.mimeType || "application/pdf");
    reply.header("Content-Length", Buffer.byteLength(result.buffer));
    reply.header(
      "Content-Disposition",
      `${disposition}; filename="${fileName}"`,
    );
    reply.header("Cache-Control", "private, no-store, max-age=0");
    reply.header("Pragma", "no-cache");

    return reply.send(result.buffer);
  } catch (e) {
    if (e?.statusCode) {
      return reply.status(e.statusCode).send({ error: e.message });
    }

    request.log?.error?.({ err: e }, "getPurchaseOrderPdf failed");
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

module.exports = {
  getPurchaseOrderPdf,
};
