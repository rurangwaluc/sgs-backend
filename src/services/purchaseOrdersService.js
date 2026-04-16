"use strict";

const { db } = require("../config/db");
const { sql, eq, and } = require("drizzle-orm");

const { purchaseOrders } = require("../db/schema/purchase_orders.schema");
const {
  purchaseOrderItems,
} = require("../db/schema/purchase_order_items.schema");
const { locations } = require("../db/schema/locations.schema");
const { suppliers } = require("../db/schema/suppliers.schema");
const { products } = require("../db/schema/products.schema");

const { safeLogAudit } = require("./auditService");

function clampInt(n, min, max, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(Math.max(Math.trunc(x), min), max);
}

function toInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cleanText(value, max = 255) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function normalizeCurrency(value, fallback = "RWF") {
  return (
    String(value || fallback)
      .trim()
      .toUpperCase()
      .slice(0, 12) || fallback
  );
}

function normalizeStatus(value, fallback = "DRAFT") {
  const v = String(value || fallback)
    .trim()
    .toUpperCase();

  const allowed = new Set([
    "DRAFT",
    "APPROVED",
    "PARTIALLY_RECEIVED",
    "RECEIVED",
    "CANCELLED",
  ]);

  return allowed.has(v) ? v : fallback;
}

function parseDateOrNull(value) {
  const s = cleanText(value, 80);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function buildProductDisplayName(product) {
  return [
    cleanText(product?.name, 180),
    cleanText(product?.brand, 80),
    cleanText(product?.model, 120),
    cleanText(product?.size, 40),
    cleanText(product?.color, 40),
    cleanText(product?.variantLabel, 120),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function mapMaybeNumericId(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function buildBranchCodePart(locationRow) {
  const raw =
    cleanText(locationRow?.code, 40) ||
    cleanText(locationRow?.name, 40) ||
    "MAIN";
  const cleaned = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "MAIN";
}

function buildDatePart(date = new Date()) {
  const d = new Date(date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function buildAutoCode(prefix, branchCode, sequence, date = new Date()) {
  const seq = String(Math.max(1, Number(sequence) || 1)).padStart(4, "0");
  return `${prefix}-${buildBranchCodePart({ code: branchCode })}-${buildDatePart(date)}-${seq}`;
}

function extractAutoCodeSequence(value, prefix, branchCode, date = new Date()) {
  const raw = cleanText(value, 160);
  if (!raw) return 0;
  const expectedPrefix = `${prefix}-${buildBranchCodePart({ code: branchCode })}-${buildDatePart(date)}-`;
  if (!raw.startsWith(expectedPrefix)) return 0;
  const tail = raw.slice(expectedPrefix.length);
  const seq = Number(tail);
  return Number.isInteger(seq) && seq > 0 ? seq : 0;
}

async function buildNextPurchaseOrderCodes(tx, { locationRow, orderedAt }) {
  const branchCode = buildBranchCodePart(locationRow);
  const effectiveDate = orderedAt || new Date();
  const result = await tx.execute(sql`
    SELECT po.po_no as "poNo", po.reference as "reference"
    FROM purchase_orders po
    WHERE po.location_id = ${Number(locationRow.id)}
    ORDER BY po.id DESC
    LIMIT 500
  `);

  const rows = result.rows || result || [];
  const poMax = rows.reduce((maxValue, row) => {
    return Math.max(
      maxValue,
      extractAutoCodeSequence(row?.poNo, "PO", branchCode, effectiveDate),
    );
  }, 0);
  const refMax = rows.reduce((maxValue, row) => {
    return Math.max(
      maxValue,
      extractAutoCodeSequence(row?.reference, "REF", branchCode, effectiveDate),
    );
  }, 0);
  const nextSequence = Math.max(poMax, refMax, 0) + 1;

  return {
    poNo: buildAutoCode("PO", branchCode, nextSequence, effectiveDate),
    reference: buildAutoCode("REF", branchCode, nextSequence, effectiveDate),
  };
}

async function getLocationOrThrow(tx, locationId) {
  const rows = await tx
    .select({
      id: locations.id,
      name: locations.name,
      code: locations.code,
      status: locations.status,
    })
    .from(locations)
    .where(eq(locations.id, Number(locationId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    const err = new Error("Branch not found");
    err.code = "LOCATION_NOT_FOUND";
    throw err;
  }

  return row;
}

async function getSupplierOrThrow(tx, supplierId) {
  const rows = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      defaultCurrency: suppliers.defaultCurrency,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(eq(suppliers.id, Number(supplierId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    const err = new Error("Supplier not found");
    err.code = "SUPPLIER_NOT_FOUND";
    throw err;
  }

  return row;
}

async function getProductForPO(tx, { locationId, productId }) {
  const rows = await tx
    .select({
      id: products.id,
      locationId: products.locationId,
      name: products.name,
      sku: products.sku,
      unit: products.unit,
      costPrice: products.costPrice,
      isActive: products.isActive,
      brand: products.brand,
      model: products.model,
      size: products.size,
      color: products.color,
      variantLabel: products.variantLabel,
    })
    .from(products)
    .where(
      and(
        eq(products.id, Number(productId)),
        eq(products.locationId, Number(locationId)),
      ),
    )
    .limit(1);

  return rows[0] || null;
}

function computePOItem(product, rawItem) {
  const qtyOrdered = Math.max(1, toInt(rawItem.qtyOrdered, 1) || 1);
  const unitCost = Math.max(
    0,
    toInt(rawItem.unitCost, product ? toInt(product.costPrice, 0) || 0 : 0) ||
      0,
  );
  const lineTotal = qtyOrdered * unitCost;

  if (product) {
    const stockUnit = cleanText(product.unit, 30) || "PIECE";
    const purchaseUnit = stockUnit;
    const purchaseUnitFactor = 1;
    const productDisplayName =
      buildProductDisplayName(product) || cleanText(product.name, 180);

    return {
      productId: Number(product.id),
      productName: cleanText(product.name, 180),
      productDisplayName,
      productSku: cleanText(product.sku, 80),
      stockUnit,
      purchaseUnit,
      purchaseUnitFactor,
      qtyOrdered,
      qtyReceived: 0,
      unitCost,
      lineTotal,
      note: cleanText(rawItem.note, 300),
    };
  }

  const manualName = cleanText(rawItem.productName, 180);
  if (!manualName) {
    const err = new Error("Each PO line needs productId or productName");
    err.code = "BAD_ITEMS";
    throw err;
  }

  return {
    productId: null,
    productName: manualName,
    productDisplayName: manualName,
    productSku: null,
    stockUnit: "PIECE",
    purchaseUnit: "PIECE",
    purchaseUnitFactor: 1,
    qtyOrdered,
    qtyReceived: 0,
    unitCost,
    lineTotal,
    note: cleanText(rawItem.note, 300),
  };
}

function mapPurchaseOrderRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    locationId: Number(row.locationId),
    locationName: row.locationName ?? null,
    locationCode: row.locationCode ?? null,

    supplierId: Number(row.supplierId),
    supplierName: row.supplierName ?? null,

    poNo: row.poNo ?? null,
    reference: row.reference ?? null,
    currency: row.currency ?? "RWF",

    status: row.status ?? "DRAFT",
    notes: row.notes ?? null,

    orderedAt: row.orderedAt,
    expectedAt: row.expectedAt,
    approvedAt: row.approvedAt,

    createdByUserId: mapMaybeNumericId(row.createdByUserId),
    createdByName: row.createdByName ?? null,
    createdByEmail: row.createdByEmail ?? null,

    approvedByUserId: mapMaybeNumericId(row.approvedByUserId),
    approvedByName: row.approvedByName ?? null,

    subtotalAmount: Number(row.subtotalAmount || 0),
    totalAmount: Number(row.totalAmount || 0),

    createdAt: row.createdAt,
    updatedAt: row.updatedAt,

    itemsCount: Number(row.itemsCount || 0),
    qtyOrderedTotal: Number(row.qtyOrderedTotal || 0),
    qtyReceivedTotal: Number(row.qtyReceivedTotal || 0),
  };
}

async function getPurchaseOrderRowOrThrow(tx, purchaseOrderId) {
  const result = await tx.execute(sql`
    SELECT
      po.id,
      po.location_id as "locationId",
      po.supplier_id as "supplierId",
      po.po_no as "poNo",
      po.reference as "reference",
      po.status as "status",
      po.notes as "notes",
      po.ordered_at as "orderedAt",
      po.expected_at as "expectedAt",
      po.approved_at as "approvedAt",
      po.created_by_user_id as "createdByUserId",
      po.approved_by_user_id as "approvedByUserId",
      po.subtotal_amount as "subtotalAmount",
      po.total_amount as "totalAmount",
      po.created_at as "createdAt",
      po.updated_at as "updatedAt"
    FROM purchase_orders po
    WHERE po.id = ${Number(purchaseOrderId)}
    LIMIT 1
  `);

  const row = (result.rows || result || [])[0];
  if (!row) {
    const err = new Error("Purchase order not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  return row;
}

async function getPurchaseOrderByIdUsing(
  executor,
  { purchaseOrderId, locationId = null },
) {
  const id = toInt(purchaseOrderId, null);
  if (!id) return null;

  let whereSql = sql`po.id = ${id}`;
  if (locationId != null) {
    whereSql = sql`${whereSql} AND po.location_id = ${Number(locationId)}`;
  }

  const headRes = await executor.execute(sql`
    SELECT
      po.id,
      po.location_id as "locationId",
      l.name as "locationName",
      l.code as "locationCode",
      l.email as "locationEmail",
      l.phone as "locationPhone",
      l.website as "locationWebsite",
      l.address as "locationAddress",
      l.logo_url as "locationLogoUrl",
      l.tin as "locationTin",

      po.supplier_id as "supplierId",
      s.name as "supplierName",
      s.contact_name as "supplierContactName",
      s.phone as "supplierPhone",
      s.email as "supplierEmail",
      s.address as "supplierAddress",

      po.po_no as "poNo",
      po.reference as "reference",
      COALESCE(po.currency, s.default_currency, 'RWF') as "currency",
      po.status as "status",
      po.notes as "notes",

      po.ordered_at as "orderedAt",
      po.expected_at as "expectedAt",
      po.approved_at as "approvedAt",

      po.created_by_user_id as "createdByUserId",
      NULL::text as "createdByName",
      NULL::text as "createdByEmail",

      po.approved_by_user_id as "approvedByUserId",
      NULL::text as "approvedByName",
      NULL::text as "approvedByEmail",

      po.subtotal_amount as "subtotalAmount",
      po.total_amount as "totalAmount",

      po.created_at as "createdAt",
      po.updated_at as "updatedAt",

      COALESCE((
        SELECT COUNT(*)::int
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = po.id
      ), 0) as "itemsCount",

      COALESCE((
        SELECT SUM(poi.qty_ordered)::int
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = po.id
      ), 0) as "qtyOrderedTotal",

      COALESCE((
        SELECT SUM(poi.qty_received)::int
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = po.id
      ), 0) as "qtyReceivedTotal"

    FROM purchase_orders po
    JOIN locations l
      ON l.id = po.location_id
    JOIN suppliers s
      ON s.id = po.supplier_id
    WHERE ${whereSql}
    LIMIT 1
  `);

  const head = (headRes.rows || headRes || [])[0];
  if (!head) return null;

  const itemsRes = await executor.execute(sql`
    SELECT
      poi.id,
      poi.purchase_order_id as "purchaseOrderId",
      poi.product_id as "productId",
      poi.product_name as "productName",
      poi.product_display_name as "productDisplayName",
      poi.product_sku as "productSku",
      poi.stock_unit as "stockUnit",
      poi.purchase_unit as "purchaseUnit",
      poi.purchase_unit_factor as "purchaseUnitFactor",
      poi.qty_ordered as "qtyOrdered",
      poi.qty_received as "qtyReceived",
      poi.unit_cost as "unitCost",
      poi.line_total as "lineTotal",
      poi.note as "note",
      poi.created_at as "createdAt"
    FROM purchase_order_items poi
    WHERE poi.purchase_order_id = ${id}
    ORDER BY poi.id ASC
  `);

  const itemRows = itemsRes.rows || itemsRes || [];

  return {
    purchaseOrder: mapPurchaseOrderRow({
      ...head,
      itemsCount: itemRows.length,
      qtyOrderedTotal: itemRows.reduce(
        (sum, row) => sum + Number(row.qtyOrdered || 0),
        0,
      ),
      qtyReceivedTotal: itemRows.reduce(
        (sum, row) => sum + Number(row.qtyReceived || 0),
        0,
      ),
    }),
    items: itemRows.map((row) => ({
      id: Number(row.id),
      purchaseOrderId: Number(row.purchaseOrderId),
      productId: row.productId == null ? null : Number(row.productId),
      productName: row.productName ?? null,
      productDisplayName: row.productDisplayName ?? null,
      productSku: row.productSku ?? null,
      stockUnit: row.stockUnit ?? "PIECE",
      purchaseUnit: row.purchaseUnit ?? "PIECE",
      purchaseUnitFactor: Number(row.purchaseUnitFactor || 1),
      qtyOrdered: Number(row.qtyOrdered || 0),
      qtyReceived: Number(row.qtyReceived || 0),
      unitCost: Number(row.unitCost || 0),
      lineTotal: Number(row.lineTotal || 0),
      note: row.note ?? null,
      createdAt: row.createdAt,
    })),
  };
}

async function createPurchaseOrder({
  actorUser,
  locationId,
  supplierId,
  poNo,
  reference,
  currency,
  notes,
  orderedAt,
  expectedAt,
  items,
}) {
  return db.transaction(async (tx) => {
    const location = await getLocationOrThrow(tx, locationId);
    const supplier = await getSupplierOrThrow(tx, supplierId);

    if (String(location.status || "").toUpperCase() !== "ACTIVE") {
      const err = new Error(
        "Purchase order can only be created for an active branch",
      );
      err.code = "BAD_LOCATION";
      throw err;
    }

    const lines = [];
    let subtotalAmount = 0;

    for (const item of items || []) {
      let product = null;

      if (item.productId != null) {
        product = await getProductForPO(tx, {
          locationId,
          productId: item.productId,
        });

        if (!product) {
          const err = new Error(`Product ${item.productId} not found`);
          err.code = "PRODUCT_NOT_FOUND";
          err.debug = { productId: item.productId };
          throw err;
        }

        if (product.isActive === false) {
          const err = new Error(`Product ${item.productId} is archived`);
          err.code = "PRODUCT_ARCHIVED";
          err.debug = { productId: item.productId };
          throw err;
        }
      }

      const line = computePOItem(product, item);
      lines.push(line);
      subtotalAmount += Number(line.lineTotal || 0);
    }

    if (!lines.length) {
      const err = new Error("Purchase order items are required");
      err.code = "BAD_ITEMS";
      throw err;
    }

    const finalCurrency = normalizeCurrency(
      currency,
      supplier.defaultCurrency || "RWF",
    );

    const orderedAtDate = parseDateOrNull(orderedAt) || new Date();
    const nextCodes = await buildNextPurchaseOrderCodes(tx, {
      locationRow: location,
      orderedAt: orderedAtDate,
    });

    const finalPoNo = cleanText(poNo, 120) || nextCodes.poNo;
    const finalReference = cleanText(reference, 120) || nextCodes.reference;

    const [created] = await tx
      .insert(purchaseOrders)
      .values({
        locationId: Number(locationId),
        supplierId: Number(supplierId),
        poNo: finalPoNo,
        reference: finalReference,
        currency: finalCurrency,
        status: "DRAFT",
        notes: cleanText(notes, 4000),
        orderedAt: orderedAtDate,
        expectedAt: parseDateOrNull(expectedAt),
        approvedAt: null,
        createdByUserId: Number(actorUser.id),
        approvedByUserId: null,
        subtotalAmount,
        totalAmount: subtotalAmount,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    for (const line of lines) {
      await tx.insert(purchaseOrderItems).values({
        purchaseOrderId: Number(created.id),
        productId: line.productId,
        productName: line.productName,
        productDisplayName: line.productDisplayName,
        productSku: line.productSku,
        stockUnit: line.stockUnit,
        purchaseUnit: line.purchaseUnit,
        purchaseUnitFactor: line.purchaseUnitFactor,
        qtyOrdered: line.qtyOrdered,
        qtyReceived: line.qtyReceived,
        unitCost: line.unitCost,
        lineTotal: line.lineTotal,
        note: line.note,
        createdAt: new Date(),
      });
    }

    await safeLogAudit({
      locationId: Number(locationId),
      userId: Number(actorUser.id),
      action: "PURCHASE_ORDER_CREATE",
      entity: "purchase_order",
      entityId: Number(created.id),
      description: `Created purchase order #${created.id}`,
      meta: {
        purchaseOrderId: Number(created.id),
        supplierId: Number(supplierId),
        itemsCount: lines.length,
        totalAmount: subtotalAmount,
      },
    });

    return getPurchaseOrderByIdUsing(tx, {
      purchaseOrderId: Number(created.id),
      locationId: null,
    });
  });
}

async function updatePurchaseOrder({
  actorUser,
  purchaseOrderId,
  supplierId,
  poNo,
  reference,
  currency,
  notes,
  orderedAt,
  expectedAt,
  items,
}) {
  return db.transaction(async (tx) => {
    const existing = await getPurchaseOrderRowOrThrow(tx, purchaseOrderId);

    const status = normalizeStatus(existing.status, "DRAFT");
    if (!["DRAFT", "APPROVED"].includes(status)) {
      const err = new Error(
        "Only DRAFT or APPROVED purchase orders can be updated",
      );
      err.code = "STATUS_LOCKED";
      throw err;
    }

    if (status !== "DRAFT" && Array.isArray(items)) {
      const err = new Error("Approved purchase order lines cannot be replaced");
      err.code = "LINES_LOCKED";
      throw err;
    }

    let nextSupplierId = Number(existing.supplierId);
    if (supplierId != null) {
      await getSupplierOrThrow(tx, supplierId);
      nextSupplierId = Number(supplierId);
    }

    const patch = {
      supplierId: nextSupplierId,
      poNo: poNo !== undefined ? cleanText(poNo, 120) : existing.poNo,
      reference:
        reference !== undefined
          ? cleanText(reference, 120)
          : existing.reference,
      currency:
        currency !== undefined ? normalizeCurrency(currency, "RWF") : "RWF",
      notes: notes !== undefined ? cleanText(notes, 4000) : existing.notes,
      orderedAt:
        orderedAt !== undefined
          ? parseDateOrNull(orderedAt) || existing.orderedAt
          : existing.orderedAt,
      expectedAt:
        expectedAt !== undefined
          ? parseDateOrNull(expectedAt)
          : existing.expectedAt,
      updatedAt: new Date(),
    };

    let subtotalAmount = Number(existing.subtotalAmount || 0);

    if (Array.isArray(items)) {
      const lines = [];
      subtotalAmount = 0;

      for (const item of items) {
        let product = null;

        if (item.productId != null) {
          product = await getProductForPO(tx, {
            locationId: Number(existing.locationId),
            productId: item.productId,
          });

          if (!product) {
            const err = new Error(`Product ${item.productId} not found`);
            err.code = "PRODUCT_NOT_FOUND";
            err.debug = { productId: item.productId };
            throw err;
          }

          if (product.isActive === false) {
            const err = new Error(`Product ${item.productId} is archived`);
            err.code = "PRODUCT_ARCHIVED";
            err.debug = { productId: item.productId };
            throw err;
          }
        }

        const line = computePOItem(product, item);
        lines.push(line);
        subtotalAmount += Number(line.lineTotal || 0);
      }

      if (!lines.length) {
        const err = new Error("Purchase order items are required");
        err.code = "BAD_ITEMS";
        throw err;
      }

      await tx.execute(sql`
        DELETE FROM purchase_order_items
        WHERE purchase_order_id = ${Number(purchaseOrderId)}
      `);

      for (const line of lines) {
        await tx.insert(purchaseOrderItems).values({
          purchaseOrderId: Number(purchaseOrderId),
          productId: line.productId,
          productName: line.productName,
          productDisplayName: line.productDisplayName,
          productSku: line.productSku,
          stockUnit: line.stockUnit,
          purchaseUnit: line.purchaseUnit,
          purchaseUnitFactor: line.purchaseUnitFactor,
          qtyOrdered: line.qtyOrdered,
          qtyReceived: line.qtyReceived,
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
          note: line.note,
          createdAt: new Date(),
        });
      }
    }

    await tx
      .update(purchaseOrders)
      .set({
        supplierId: patch.supplierId,
        poNo: patch.poNo,
        reference: patch.reference,
        currency: patch.currency,
        notes: patch.notes,
        orderedAt: patch.orderedAt,
        expectedAt: patch.expectedAt,
        subtotalAmount,
        totalAmount: subtotalAmount,
        updatedAt: patch.updatedAt,
      })
      .where(eq(purchaseOrders.id, Number(purchaseOrderId)));

    await safeLogAudit({
      locationId: Number(existing.locationId),
      userId: Number(actorUser.id),
      action: "PURCHASE_ORDER_UPDATE",
      entity: "purchase_order",
      entityId: Number(purchaseOrderId),
      description: `Updated purchase order #${purchaseOrderId}`,
      meta: {
        purchaseOrderId: Number(purchaseOrderId),
      },
    });

    return getPurchaseOrderByIdUsing(tx, {
      purchaseOrderId: Number(purchaseOrderId),
      locationId: null,
    });
  });
}

async function approvePurchaseOrder({ actorUser, purchaseOrderId }) {
  return db.transaction(async (tx) => {
    const existing = await getPurchaseOrderRowOrThrow(tx, purchaseOrderId);

    const status = normalizeStatus(existing.status, "DRAFT");
    if (status !== "DRAFT") {
      const err = new Error("Only DRAFT purchase orders can be approved");
      err.code = "BAD_STATUS";
      throw err;
    }

    await tx
      .update(purchaseOrders)
      .set({
        status: "APPROVED",
        approvedAt: new Date(),
        approvedByUserId: Number(actorUser.id),
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, Number(purchaseOrderId)));

    await safeLogAudit({
      locationId: Number(existing.locationId),
      userId: Number(actorUser.id),
      action: "PURCHASE_ORDER_APPROVE",
      entity: "purchase_order",
      entityId: Number(purchaseOrderId),
      description: `Approved purchase order #${purchaseOrderId}`,
      meta: {
        purchaseOrderId: Number(purchaseOrderId),
      },
    });

    return getPurchaseOrderByIdUsing(tx, {
      purchaseOrderId: Number(purchaseOrderId),
      locationId: null,
    });
  });
}

async function cancelPurchaseOrder({ actorUser, purchaseOrderId, reason }) {
  return db.transaction(async (tx) => {
    const existing = await getPurchaseOrderRowOrThrow(tx, purchaseOrderId);

    const status = normalizeStatus(existing.status, "DRAFT");
    if (["RECEIVED", "CANCELLED"].includes(status)) {
      const err = new Error("Purchase order cannot be cancelled");
      err.code = "BAD_STATUS";
      throw err;
    }

    const itemsRes = await tx.execute(sql`
      SELECT COALESCE(SUM(qty_received),0)::int as received_qty
      FROM purchase_order_items
      WHERE purchase_order_id = ${Number(purchaseOrderId)}
    `);

    const receivedQty = Number(
      (itemsRes.rows || itemsRes || [])[0]?.received_qty || 0,
    );

    if (receivedQty > 0) {
      const err = new Error(
        "Cannot cancel a purchase order that already has receipts",
      );
      err.code = "HAS_RECEIPTS";
      throw err;
    }

    const nextNotes = [cleanText(existing.notes, 4000), cleanText(reason, 300)]
      .filter(Boolean)
      .join(" | ");

    await tx
      .update(purchaseOrders)
      .set({
        status: "CANCELLED",
        notes: nextNotes || existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(purchaseOrders.id, Number(purchaseOrderId)));

    await safeLogAudit({
      locationId: Number(existing.locationId),
      userId: Number(actorUser.id),
      action: "PURCHASE_ORDER_CANCEL",
      entity: "purchase_order",
      entityId: Number(purchaseOrderId),
      description: `Cancelled purchase order #${purchaseOrderId}`,
      meta: {
        purchaseOrderId: Number(purchaseOrderId),
        reason: cleanText(reason, 300),
      },
    });

    return getPurchaseOrderByIdUsing(tx, {
      purchaseOrderId: Number(purchaseOrderId),
      locationId: null,
    });
  });
}

async function listPurchaseOrders({
  locationId = null,
  supplierId = null,
  status = null,
  q = null,
  from = null,
  toExclusive = null,
  limit = 50,
  cursor = null,
}) {
  const lim = clampInt(limit, 1, 200, 50);
  const cursorId = toInt(cursor, null);
  const supplierIdInt = toInt(supplierId, null);
  const statusValue = status ? normalizeStatus(status, "") : null;
  const search = cleanText(q, 200);

  let where = sql`TRUE`;

  if (locationId != null) {
    where = sql`${where} AND po.location_id = ${Number(locationId)}`;
  }

  if (supplierIdInt != null) {
    where = sql`${where} AND po.supplier_id = ${supplierIdInt}`;
  }

  if (statusValue) {
    where = sql`${where} AND po.status = ${statusValue}`;
  }

  if (cursorId != null && cursorId > 0) {
    where = sql`${where} AND po.id < ${cursorId}`;
  }

  if (from) {
    where = sql`${where} AND po.ordered_at >= ${from}`;
  }

  if (toExclusive) {
    where = sql`${where} AND po.ordered_at < ${toExclusive}`;
  }

  if (search) {
    const like = `%${search}%`;
    where = sql`${where} AND (
      CAST(po.id AS text) ILIKE ${like}
      OR COALESCE(po.po_no, '') ILIKE ${like}
      OR COALESCE(po.reference, '') ILIKE ${like}
      OR COALESCE(po.notes, '') ILIKE ${like}
      OR COALESCE(s.name, '') ILIKE ${like}
      OR COALESCE(s.default_currency, '') ILIKE ${like}
      OR COALESCE(l.name, '') ILIKE ${like}
      OR COALESCE(l.code, '') ILIKE ${like}
    )`;
  }

  const result = await db.execute(sql`
    SELECT
      po.id,
      po.location_id as "locationId",
      l.name as "locationName",
      l.code as "locationCode",

      po.supplier_id as "supplierId",
      s.name as "supplierName",

      po.po_no as "poNo",
      po.reference as "reference",
      COALESCE(po.currency, s.default_currency, 'RWF') as "currency",
      po.status as "status",
      po.notes as "notes",

      po.ordered_at as "orderedAt",
      po.expected_at as "expectedAt",
      po.approved_at as "approvedAt",

      po.created_by_user_id as "createdByUserId",
      NULL::text as "createdByName",
      NULL::text as "createdByEmail",

      po.approved_by_user_id as "approvedByUserId",
      NULL::text as "approvedByName",

      po.subtotal_amount as "subtotalAmount",
      po.total_amount as "totalAmount",

      po.created_at as "createdAt",
      po.updated_at as "updatedAt",

      COALESCE((
        SELECT COUNT(*)::int
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = po.id
      ), 0) as "itemsCount",

      COALESCE((
        SELECT SUM(poi.qty_ordered)::int
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = po.id
      ), 0) as "qtyOrderedTotal",

      COALESCE((
        SELECT SUM(poi.qty_received)::int
        FROM purchase_order_items poi
        WHERE poi.purchase_order_id = po.id
      ), 0) as "qtyReceivedTotal"

    FROM purchase_orders po
    JOIN locations l
      ON l.id = po.location_id
    JOIN suppliers s
      ON s.id = po.supplier_id
    WHERE ${where}
    ORDER BY po.id DESC
    LIMIT ${lim}
  `);

  const rows = (result.rows || result || []).map(mapPurchaseOrderRow);
  const nextCursor = rows.length === lim ? rows[rows.length - 1].id : null;

  return { rows, nextCursor };
}

async function getPurchaseOrderById({ purchaseOrderId, locationId = null }) {
  return getPurchaseOrderByIdUsing(db, { purchaseOrderId, locationId });
}

module.exports = {
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrderById,
};
