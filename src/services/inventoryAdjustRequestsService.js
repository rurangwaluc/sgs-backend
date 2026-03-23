"use strict";

const { db } = require("../config/db");
const { and, eq, sql } = require("drizzle-orm");

const notificationService = require("./notificationService");

const {
  inventoryAdjustmentRequests,
} = require("../db/schema/inventory_adjustment_requests.schema");

const { inventoryBalances } = require("../db/schema/inventory.schema");
const { auditLogs } = require("../db/schema/audit_logs.schema");

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function normalizeStatus(value) {
  const s = String(value || "")
    .trim()
    .toUpperCase();

  if (!s || s === "ALL") return null;
  if (["PENDING", "APPROVED", "DECLINED"].includes(s)) return s;
  return null;
}

function cleanReason(value) {
  const s = String(value || "").trim();
  return s || null;
}

function mapRequestRow(r) {
  return {
    id: Number(r?.id ?? 0),
    locationId: Number(r?.locationId ?? r?.location_id ?? 0),
    productId: Number(r?.productId ?? r?.product_id ?? 0),
    qtyChange: Number(r?.qtyChange ?? r?.qty_change ?? 0),
    reason: r?.reason ?? "",
    status: r?.status ?? "PENDING",
    requestedByUserId: Number(
      r?.requestedByUserId ?? r?.requested_by_user_id ?? 0,
    ),
    decidedByUserId:
      r?.decidedByUserId == null && r?.decided_by_user_id == null
        ? null
        : Number(r?.decidedByUserId ?? r?.decided_by_user_id ?? 0),
    createdAt: r?.createdAt ?? r?.created_at ?? null,
    decidedAt: r?.decidedAt ?? r?.decided_at ?? null,
    productName: r?.productName ?? "Unknown Product",
  };
}

/**
 * Create inventory adjustment request
 */
async function createRequest({
  locationId,
  productId,
  qtyChange,
  reason,
  requestedByUserId,
}) {
  const parsedLocationId = toInt(locationId);
  const parsedProductId = toInt(productId);
  const parsedQtyChange = toInt(qtyChange);
  const parsedRequestedByUserId = toInt(requestedByUserId);
  const normalizedReason = cleanReason(reason);

  if (!parsedLocationId || !parsedProductId || !parsedRequestedByUserId) {
    const err = new Error("Invalid request payload");
    err.code = "BAD_PAYLOAD";
    throw err;
  }

  if (!parsedQtyChange) {
    const err = new Error("qtyChange must be a non-zero integer");
    err.code = "BAD_QTY_CHANGE";
    throw err;
  }

  return db.transaction(async (tx) => {
    const insertedRows = await tx
      .insert(inventoryAdjustmentRequests)
      .values({
        locationId: parsedLocationId,
        productId: parsedProductId,
        qtyChange: parsedQtyChange,
        reason: normalizedReason,
        status: "PENDING",
        requestedByUserId: parsedRequestedByUserId,
        decidedByUserId: null,
        decidedAt: null,
        createdAt: new Date(),
      })
      .returning();

    const row = insertedRows[0];

    await tx.insert(auditLogs).values({
      locationId: parsedLocationId,
      userId: parsedRequestedByUserId,
      action: "INVENTORY_ADJUST_REQUEST_CREATE",
      entity: "inventory_adjustment_request",
      entityId: row.id,
      description: `Requested inventory adjustment: productId=${parsedProductId}, qtyChange=${parsedQtyChange}. reason=${normalizedReason || "-"}`,
    });

    await notificationService.notifyRoles({
      locationId: parsedLocationId,
      roles: ["manager", "admin"],
      actorUserId: parsedRequestedByUserId,
      type: "INVENTORY_ADJUST_REQUEST_CREATED",
      title: "Inventory adjustment request",
      body: `Product #${parsedProductId}, change: ${parsedQtyChange}. Reason: ${normalizedReason || "-"}. Request #${row.id}.`,
      priority: "warn",
      entity: "inventory_adjustment_request",
      entityId: Number(row.id),
    });

    return mapRequestRow(row);
  });
}

/**
 * List inventory adjustment requests
 * - store_keeper => only own requests
 * - manager/admin/owner => all requests in current branch
 */
async function listRequests({
  locationId,
  role,
  userId,
  status,
  limit = 100,
  offset = 0,
} = {}) {
  const locId = toInt(locationId);
  const uid = toInt(userId);
  const lim = Math.max(1, Math.min(500, toInt(limit, 100)));
  const off = Math.max(0, toInt(offset, 0));
  const normalizedRole = String(role || "")
    .trim()
    .toLowerCase();
  const normalizedStatus = normalizeStatus(status);

  if (!locId) {
    const err = new Error("Missing locationId");
    err.code = "BAD_CONTEXT";
    throw err;
  }

  const sellerScopeSql =
    normalizedRole === "store_keeper"
      ? sql`AND r.requested_by_user_id = ${uid}`
      : sql``;

  const statusSql = normalizedStatus
    ? sql`AND UPPER(r.status) = ${normalizedStatus}`
    : sql``;

  const result = await db.execute(sql`
    SELECT
      r.id,
      r.location_id AS "locationId",
      r.product_id AS "productId",
      r.qty_change AS "qtyChange",
      r.reason,
      r.status,
      r.requested_by_user_id AS "requestedByUserId",
      r.decided_by_user_id AS "decidedByUserId",
      r.created_at AS "createdAt",
      r.decided_at AS "decidedAt",
      COALESCE(p.name, CONCAT('Product #', r.product_id::text)) AS "productName"
    FROM inventory_adjustment_requests r
    LEFT JOIN products p
      ON p.id = r.product_id
    WHERE r.location_id = ${locId}
    ${sellerScopeSql}
    ${statusSql}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ${lim}
    OFFSET ${off}
  `);

  const rows = result.rows || result || [];
  return rows.map(mapRequestRow);
}

/**
 * Approve / Decline inventory adjustment request
 */
async function decideRequest({
  locationId,
  managerId,
  requestId,
  decision,
  note,
}) {
  const parsedLocationId = toInt(locationId);
  const parsedManagerId = toInt(managerId);
  const parsedRequestId = toInt(requestId);
  const normalizedDecision = String(decision || "")
    .trim()
    .toUpperCase();
  const normalizedNote = cleanReason(note);

  if (!parsedLocationId || !parsedManagerId || !parsedRequestId) {
    const err = new Error("Invalid decision payload");
    err.code = "BAD_PAYLOAD";
    throw err;
  }

  if (!["APPROVE", "DECLINE"].includes(normalizedDecision)) {
    const err = new Error("Invalid decision");
    err.code = "BAD_DECISION";
    throw err;
  }

  return db.transaction(async (tx) => {
    const reqRows = await tx
      .select()
      .from(inventoryAdjustmentRequests)
      .where(
        and(
          eq(inventoryAdjustmentRequests.id, parsedRequestId),
          eq(inventoryAdjustmentRequests.locationId, parsedLocationId),
        ),
      )
      .limit(1);

    const reqRow = reqRows[0];

    if (!reqRow) {
      const err = new Error("Request not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    if (String(reqRow.status || "").toUpperCase() !== "PENDING") {
      const err = new Error("Already decided");
      err.code = "ALREADY_DECIDED";
      throw err;
    }

    const nextStatus =
      normalizedDecision === "APPROVE" ? "APPROVED" : "DECLINED";

    if (normalizedDecision === "APPROVE") {
      const balanceRows = await tx
        .select({
          id: inventoryBalances.id,
          qtyOnHand: inventoryBalances.qtyOnHand,
        })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.locationId, parsedLocationId),
            eq(inventoryBalances.productId, reqRow.productId),
          ),
        )
        .limit(1);

      const balance = balanceRows[0];

      if (balance) {
        await tx
          .update(inventoryBalances)
          .set({
            qtyOnHand:
              Number(balance.qtyOnHand || 0) + Number(reqRow.qtyChange || 0),
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, balance.id));
      } else {
        await tx.insert(inventoryBalances).values({
          locationId: parsedLocationId,
          productId: reqRow.productId,
          qtyOnHand: Number(reqRow.qtyChange || 0),
          updatedAt: new Date(),
        });
      }
    }

    const updatedRows = await tx
      .update(inventoryAdjustmentRequests)
      .set({
        status: nextStatus,
        decidedByUserId: parsedManagerId,
        decidedAt: new Date(),
      })
      .where(eq(inventoryAdjustmentRequests.id, parsedRequestId))
      .returning();

    const updated = updatedRows[0];

    await tx.insert(auditLogs).values({
      locationId: parsedLocationId,
      userId: parsedManagerId,
      action:
        normalizedDecision === "APPROVE"
          ? "INVENTORY_ADJUST_REQUEST_APPROVE"
          : "INVENTORY_ADJUST_REQUEST_DECLINE",
      entity: "inventory_adjustment_request",
      entityId: parsedRequestId,
      description: `Adjustment request #${parsedRequestId} ${nextStatus}. note=${normalizedNote || "-"}`,
    });

    return mapRequestRow(updated);
  });
}

async function approveRequest({ id, locationId, decidedByUserId }) {
  return decideRequest({
    locationId,
    managerId: decidedByUserId,
    requestId: id,
    decision: "APPROVE",
  });
}

async function declineRequest({ id, locationId, decidedByUserId }) {
  return decideRequest({
    locationId,
    managerId: decidedByUserId,
    requestId: id,
    decision: "DECLINE",
  });
}

module.exports = {
  createRequest,
  listRequests,
  approveRequest,
  declineRequest,
};
