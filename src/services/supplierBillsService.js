"use strict";

const { and, desc, eq, sql } = require("drizzle-orm");

const { db } = require("../config/db");
const AUDIT = require("../audit/actions");
const { safeLogAudit } = require("./auditService");
const { suppliers } = require("../db/schema/suppliers.schema");
const { purchaseOrders } = require("../db/schema/purchase_orders.schema");
const { goodsReceipts } = require("../db/schema/goods_receipts.schema");
const {
  supplierBills,
  supplierBillItems,
  supplierBillPayments,
} = require("../db/schema/supplier_bills.schema");
const {
  supplierBillCreateSchema,
  supplierBillUpdateSchema,
  supplierBillPaymentCreateSchema,
} = require("../validators/supplierBills.schema");

function toInt(v, def = null) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

function cleanDate(v) {
  const s = cleanStr(v);
  return s || null;
}

function moneyInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function normalizeCurrency(v, fallback = "RWF") {
  const s = String(v || fallback)
    .trim()
    .toUpperCase()
    .slice(0, 8);
  return s || fallback;
}

function normalizeMethod(v, fallback = "BANK") {
  const s = String(v || fallback)
    .trim()
    .toUpperCase()
    .slice(0, 20);
  return s || fallback;
}

function computeTotalsFromItems(items) {
  const safeItems = Array.isArray(items) ? items : [];

  const lines = safeItems.map((it) => {
    const qty = moneyInt(it.qty);
    const unitCost = moneyInt(it.unitCost);
    const lineTotal = qty * unitCost;

    return {
      productId:
        it.productId != null
          ? Math.trunc(Number(it.productId) || 0) || null
          : null,
      description: String(it.description || "").trim() || "Item",
      qty,
      unitCost,
      lineTotal,
    };
  });

  const totalAmount = lines.reduce(
    (sum, line) => sum + Number(line.lineTotal || 0),
    0,
  );

  return { lines, totalAmount };
}

function deriveBillStatus({ totalAmount, paidAmount, requestedStatus }) {
  const total = moneyInt(totalAmount);
  const paid = moneyInt(paidAmount);
  const requested = String(requestedStatus || "")
    .trim()
    .toUpperCase();

  if (requested === "VOID") return "VOID";
  if (requested === "DRAFT" && paid <= 0) return "DRAFT";
  if (paid <= 0) return "OPEN";
  if (paid >= total) return "PAID";
  return "PARTIALLY_PAID";
}

function ensurePositiveTotal(totalAmount) {
  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    const err = new Error("totalAmount must be > 0");
    err.statusCode = 400;
    throw err;
  }
}

async function getSupplierOrThrow(supplierId) {
  const sid = Number(supplierId);
  if (!Number.isInteger(sid) || sid <= 0) {
    const err = new Error("Invalid supplierId");
    err.statusCode = 400;
    throw err;
  }

  const [row] = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      isActive: suppliers.isActive,
      defaultCurrency: suppliers.defaultCurrency,
    })
    .from(suppliers)
    .where(eq(suppliers.id, sid));

  if (!row) {
    const err = new Error("Supplier not found");
    err.statusCode = 404;
    throw err;
  }

  if (!row.isActive) {
    const err = new Error("Supplier is inactive");
    err.statusCode = 409;
    throw err;
  }

  return row;
}

async function getPurchaseOrderOrThrow({
  purchaseOrderId,
  locationId,
  tx = db,
}) {
  const poId = Number(purchaseOrderId);
  const lid = Number(locationId);

  if (!Number.isInteger(poId) || poId <= 0) {
    const err = new Error("Invalid purchaseOrderId");
    err.statusCode = 400;
    throw err;
  }

  if (!Number.isInteger(lid) || lid <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const [row] = await tx
    .select({
      id: purchaseOrders.id,
      supplierId: purchaseOrders.supplierId,
      locationId: purchaseOrders.locationId,
      currency: purchaseOrders.currency,
      status: purchaseOrders.status,
      poNo: purchaseOrders.poNo,
      totalAmount: purchaseOrders.totalAmount,
    })
    .from(purchaseOrders)
    .where(
      and(eq(purchaseOrders.id, poId), eq(purchaseOrders.locationId, lid)),
    );

  if (!row) {
    const err = new Error("Purchase order not found");
    err.statusCode = 404;
    throw err;
  }

  return row;
}

async function getGoodsReceiptOrThrow({ goodsReceiptId, locationId, tx = db }) {
  const grId = Number(goodsReceiptId);
  const lid = Number(locationId);

  if (!Number.isInteger(grId) || grId <= 0) {
    const err = new Error("Invalid goodsReceiptId");
    err.statusCode = 400;
    throw err;
  }

  if (!Number.isInteger(lid) || lid <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const [row] = await tx
    .select({
      id: goodsReceipts.id,
      purchaseOrderId: goodsReceipts.purchaseOrderId,
      supplierId: goodsReceipts.supplierId,
      locationId: goodsReceipts.locationId,
      receiptNo: goodsReceipts.receiptNo,
      totalAmount: goodsReceipts.totalAmount,
      receivedAt: goodsReceipts.receivedAt,
    })
    .from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, grId), eq(goodsReceipts.locationId, lid)));

  if (!row) {
    const err = new Error("Goods receipt not found");
    err.statusCode = 404;
    throw err;
  }

  return row;
}

async function validateProcurementLinks({
  supplierId,
  locationId,
  purchaseOrderId = null,
  goodsReceiptId = null,
  tx = db,
}) {
  const poId = toInt(purchaseOrderId, null);
  const grId = toInt(goodsReceiptId, null);
  const sid = Number(supplierId);
  const lid = Number(locationId);

  let purchaseOrderRow = null;
  let goodsReceiptRow = null;

  if (poId != null) {
    purchaseOrderRow = await getPurchaseOrderOrThrow({
      purchaseOrderId: poId,
      locationId: lid,
      tx,
    });

    if (Number(purchaseOrderRow.supplierId) !== sid) {
      const err = new Error(
        "purchaseOrderId does not belong to the selected supplier",
      );
      err.statusCode = 409;
      throw err;
    }
  }

  if (grId != null) {
    goodsReceiptRow = await getGoodsReceiptOrThrow({
      goodsReceiptId: grId,
      locationId: lid,
      tx,
    });

    if (Number(goodsReceiptRow.supplierId) !== sid) {
      const err = new Error(
        "goodsReceiptId does not belong to the selected supplier",
      );
      err.statusCode = 409;
      throw err;
    }
  }

  if (purchaseOrderRow && goodsReceiptRow) {
    if (
      Number(goodsReceiptRow.purchaseOrderId || 0) !==
      Number(purchaseOrderRow.id || 0)
    ) {
      const err = new Error(
        "goodsReceiptId does not belong to the selected purchaseOrderId",
      );
      err.statusCode = 409;
      throw err;
    }
  }

  return {
    purchaseOrder: purchaseOrderRow,
    goodsReceipt: goodsReceiptRow,
  };
}

async function getScopedBillOrThrow({ billId, locationId, tx = db }) {
  const id = Number(billId);
  const lid = Number(locationId);

  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error("Invalid bill id");
    err.statusCode = 400;
    throw err;
  }

  if (!Number.isInteger(lid) || lid <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const [bill] = await tx
    .select()
    .from(supplierBills)
    .where(and(eq(supplierBills.id, id), eq(supplierBills.locationId, lid)));

  if (!bill) {
    const err = new Error("Bill not found");
    err.statusCode = 404;
    throw err;
  }

  return bill;
}

async function listSupplierBills({
  locationId,
  q,
  supplierId,
  status,
  limit = 50,
  offset = 0,
}) {
  const lid = Number(locationId);
  if (!Number.isInteger(lid) || lid <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const query = String(q || "").trim();
  const sid = supplierId ? Number(supplierId) : null;
  const st = String(status || "")
    .trim()
    .toUpperCase();
  const lim = Math.max(1, Math.min(100, toInt(limit, 50) || 50));
  const off = Math.max(0, toInt(offset, 0) || 0);

  const where = [eq(supplierBills.locationId, lid)];

  if (sid && Number.isInteger(sid) && sid > 0) {
    where.push(eq(supplierBills.supplierId, sid));
  }

  if (st) {
    where.push(eq(supplierBills.status, st));
  }

  if (query) {
    const like = `%${query}%`;
    where.push(sql`(
      ${supplierBills.billNo} ILIKE ${like}
      OR ${supplierBills.note} ILIKE ${like}
      OR ${suppliers.name} ILIKE ${like}
      OR CAST(${supplierBills.purchaseOrderId} AS text) ILIKE ${like}
      OR CAST(${supplierBills.goodsReceiptId} AS text) ILIKE ${like}
    )`);
  }

  const rows = await db
    .select({
      id: supplierBills.id,
      supplierId: supplierBills.supplierId,
      locationId: supplierBills.locationId,
      purchaseOrderId: supplierBills.purchaseOrderId,
      goodsReceiptId: supplierBills.goodsReceiptId,
      supplierName: suppliers.name,
      billNo: supplierBills.billNo,
      currency: supplierBills.currency,
      totalAmount: supplierBills.totalAmount,
      paidAmount: supplierBills.paidAmount,
      balance:
        sql`GREATEST(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)::int`.as(
          "balance",
        ),
      status: supplierBills.status,
      issuedDate: supplierBills.issuedDate,
      dueDate: supplierBills.dueDate,
      note: supplierBills.note,
      createdByUserId: supplierBills.createdByUserId,
      createdAt: supplierBills.createdAt,
      updatedAt: supplierBills.updatedAt,
      isOverdue: sql`
        CASE
          WHEN ${supplierBills.dueDate} IS NOT NULL
           AND ${supplierBills.dueDate} < CURRENT_DATE
           AND ${supplierBills.status} NOT IN ('PAID', 'VOID')
          THEN true
          ELSE false
        END
      `.as("isOverdue"),
      daysOverdue: sql`
        CASE
          WHEN ${supplierBills.dueDate} IS NOT NULL
           AND ${supplierBills.dueDate} < CURRENT_DATE
           AND ${supplierBills.status} NOT IN ('PAID', 'VOID')
          THEN (CURRENT_DATE - ${supplierBills.dueDate})::int
          ELSE 0
        END
      `.as("daysOverdue"),
    })
    .from(supplierBills)
    .leftJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .where(and(...where))
    .orderBy(desc(supplierBills.id))
    .limit(lim)
    .offset(off);

  return rows || [];
}

async function getSupplierBill({ id, locationId }) {
  const bid = Number(id);
  const lid = Number(locationId);

  if (!Number.isInteger(bid) || bid <= 0) {
    const err = new Error("Invalid bill id");
    err.statusCode = 400;
    throw err;
  }

  if (!Number.isInteger(lid) || lid <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const [bill] = await db
    .select({
      id: supplierBills.id,
      supplierId: supplierBills.supplierId,
      locationId: supplierBills.locationId,
      purchaseOrderId: supplierBills.purchaseOrderId,
      goodsReceiptId: supplierBills.goodsReceiptId,
      supplierName: suppliers.name,
      billNo: supplierBills.billNo,
      currency: supplierBills.currency,
      totalAmount: supplierBills.totalAmount,
      paidAmount: supplierBills.paidAmount,
      balance:
        sql`GREATEST(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)::int`.as(
          "balance",
        ),
      status: supplierBills.status,
      issuedDate: supplierBills.issuedDate,
      dueDate: supplierBills.dueDate,
      note: supplierBills.note,
      createdByUserId: supplierBills.createdByUserId,
      createdAt: supplierBills.createdAt,
      updatedAt: supplierBills.updatedAt,
      isOverdue: sql`
        CASE
          WHEN ${supplierBills.dueDate} IS NOT NULL
           AND ${supplierBills.dueDate} < CURRENT_DATE
           AND ${supplierBills.status} NOT IN ('PAID', 'VOID')
          THEN true
          ELSE false
        END
      `.as("isOverdue"),
      daysOverdue: sql`
        CASE
          WHEN ${supplierBills.dueDate} IS NOT NULL
           AND ${supplierBills.dueDate} < CURRENT_DATE
           AND ${supplierBills.status} NOT IN ('PAID', 'VOID')
          THEN (CURRENT_DATE - ${supplierBills.dueDate})::int
          ELSE 0
        END
      `.as("daysOverdue"),
    })
    .from(supplierBills)
    .leftJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .where(and(eq(supplierBills.id, bid), eq(supplierBills.locationId, lid)));

  if (!bill) {
    const err = new Error("Bill not found");
    err.statusCode = 404;
    throw err;
  }

  const items = await db
    .select()
    .from(supplierBillItems)
    .where(eq(supplierBillItems.billId, bid))
    .orderBy(desc(supplierBillItems.id));

  const payments = await db
    .select()
    .from(supplierBillPayments)
    .where(eq(supplierBillPayments.billId, bid))
    .orderBy(desc(supplierBillPayments.id));

  return { bill, items, payments };
}

async function createSupplierBill({ actorUser, payload }) {
  const parsed = supplierBillCreateSchema.safeParse(payload || {});
  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const data = parsed.data;
  const locationId =
    data.locationId != null
      ? Number(data.locationId)
      : Number(actorUser?.locationId);

  if (!Number.isInteger(locationId) || locationId <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const supplier = await getSupplierOrThrow(data.supplierId);

  let totalAmount = data.totalAmount != null ? moneyInt(data.totalAmount) : 0;
  let lines = [];

  if (Array.isArray(data.items) && data.items.length > 0) {
    const computed = computeTotalsFromItems(data.items);
    totalAmount = computed.totalAmount;
    lines = computed.lines;
  }

  ensurePositiveTotal(totalAmount);

  const createdByUserId = actorUser?.id ? Number(actorUser.id) : null;

  const result = await db.transaction(async (tx) => {
    const links = await validateProcurementLinks({
      supplierId: supplier.id,
      locationId,
      purchaseOrderId: data.purchaseOrderId,
      goodsReceiptId: data.goodsReceiptId,
      tx,
    });

    const resolvedCurrency = normalizeCurrency(
      data.currency,
      links.purchaseOrder?.currency || supplier.defaultCurrency || "RWF",
    );

    const finalStatus = deriveBillStatus({
      totalAmount,
      paidAmount: 0,
      requestedStatus: data.status,
    });

    const [bill] = await tx
      .insert(supplierBills)
      .values({
        supplierId: supplier.id,
        locationId,
        purchaseOrderId: toInt(data.purchaseOrderId, null),
        goodsReceiptId: toInt(data.goodsReceiptId, null),
        billNo: cleanStr(data.billNo),
        currency: resolvedCurrency,
        totalAmount,
        paidAmount: 0,
        status: finalStatus,
        issuedDate: cleanDate(data.issuedDate),
        dueDate: cleanDate(data.dueDate),
        note: cleanStr(data.note),
        createdByUserId,
        updatedAt: sql`now()`,
      })
      .returning();

    if (lines.length > 0) {
      await tx.insert(supplierBillItems).values(
        lines.map((x) => ({
          billId: bill.id,
          productId: x.productId || null,
          description: x.description,
          qty: x.qty,
          unitCost: x.unitCost,
          lineTotal: x.lineTotal,
        })),
      );
    }

    return {
      bill,
      purchaseOrder: links.purchaseOrder,
      goodsReceipt: links.goodsReceipt,
    };
  });

  await safeLogAudit({
    locationId,
    userId: createdByUserId,
    action: AUDIT.SUPPLIER_BILL_CREATE,
    entity: "supplier_bill",
    entityId: result.bill.id,
    description: `Created supplier bill #${result.bill.id}`,
    meta: {
      supplierId: result.bill.supplierId,
      purchaseOrderId: result.bill.purchaseOrderId || null,
      goodsReceiptId: result.bill.goodsReceiptId || null,
      status: result.bill.status,
      totalAmount: result.bill.totalAmount,
      currency: result.bill.currency,
    },
  });

  return result.bill;
}

async function updateSupplierBill({ id, actorUser, payload }) {
  const billId = Number(id);
  const locationId = Number(actorUser?.locationId);

  if (!Number.isInteger(billId) || billId <= 0) {
    const err = new Error("Invalid bill id");
    err.statusCode = 400;
    throw err;
  }

  if (!Number.isInteger(locationId) || locationId <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const parsed = supplierBillUpdateSchema.safeParse(payload || {});
  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const data = parsed.data;
  const existing = await getScopedBillOrThrow({ billId, locationId });

  const currentStatus = String(existing.status || "").toUpperCase();
  if (currentStatus === "PAID" || currentStatus === "VOID") {
    const err = new Error(`Bill is ${currentStatus}; editing is locked.`);
    err.statusCode = 409;
    throw err;
  }

  const hasPayments = Number(existing.paidAmount || 0) > 0;
  const wantsStructuralChange =
    data.billNo !== undefined ||
    data.currency !== undefined ||
    data.totalAmount !== undefined ||
    data.issuedDate !== undefined ||
    data.items !== undefined ||
    data.status !== undefined ||
    data.purchaseOrderId !== undefined ||
    data.goodsReceiptId !== undefined ||
    data.supplierId !== undefined ||
    data.locationId !== undefined;

  if (hasPayments && wantsStructuralChange) {
    const err = new Error(
      "Bill already has payment history. Only due date and note can be changed now.",
    );
    err.statusCode = 409;
    throw err;
  }

  let nextTotalAmount = null;
  let lines = null;

  if (Array.isArray(data.items)) {
    const computed = computeTotalsFromItems(data.items);
    nextTotalAmount = computed.totalAmount;
    lines = computed.lines;
    ensurePositiveTotal(nextTotalAmount);
  } else if (data.totalAmount != null) {
    nextTotalAmount = moneyInt(data.totalAmount);
    ensurePositiveTotal(nextTotalAmount);
  }

  const nextSupplierId =
    data.supplierId !== undefined
      ? Number(data.supplierId)
      : existing.supplierId;

  if (
    !Number.isInteger(Number(nextSupplierId)) ||
    Number(nextSupplierId) <= 0
  ) {
    const err = new Error("Invalid supplierId");
    err.statusCode = 400;
    throw err;
  }

  const supplier =
    data.supplierId !== undefined
      ? await getSupplierOrThrow(nextSupplierId)
      : await getSupplierOrThrow(existing.supplierId);

  const nextPurchaseOrderId =
    data.purchaseOrderId !== undefined
      ? toInt(data.purchaseOrderId, null)
      : toInt(existing.purchaseOrderId, null);

  const nextGoodsReceiptId =
    data.goodsReceiptId !== undefined
      ? toInt(data.goodsReceiptId, null)
      : toInt(existing.goodsReceiptId, null);

  await validateProcurementLinks({
    supplierId: supplier.id,
    locationId,
    purchaseOrderId: nextPurchaseOrderId,
    goodsReceiptId: nextGoodsReceiptId,
  });

  const requestedStatus =
    data.status != null ? String(data.status).toUpperCase() : undefined;

  const nextStatus =
    requestedStatus != null
      ? deriveBillStatus({
          totalAmount:
            nextTotalAmount != null ? nextTotalAmount : existing.totalAmount,
          paidAmount: existing.paidAmount,
          requestedStatus,
        })
      : undefined;

  const nextCurrency =
    data.currency !== undefined
      ? normalizeCurrency(data.currency, existing.currency || "RWF")
      : existing.currency;

  const [row] = await db
    .update(supplierBills)
    .set({
      ...(data.supplierId !== undefined ? { supplierId: supplier.id } : {}),
      ...(data.purchaseOrderId !== undefined
        ? { purchaseOrderId: nextPurchaseOrderId }
        : {}),
      ...(data.goodsReceiptId !== undefined
        ? { goodsReceiptId: nextGoodsReceiptId }
        : {}),
      ...(data.billNo !== undefined ? { billNo: cleanStr(data.billNo) } : {}),
      ...(data.currency !== undefined ? { currency: nextCurrency } : {}),
      ...(nextTotalAmount != null ? { totalAmount: nextTotalAmount } : {}),
      ...(data.issuedDate !== undefined
        ? { issuedDate: cleanDate(data.issuedDate) }
        : {}),
      ...(data.dueDate !== undefined
        ? { dueDate: cleanDate(data.dueDate) }
        : {}),
      ...(data.note !== undefined ? { note: cleanStr(data.note) } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(supplierBills.id, billId),
        eq(supplierBills.locationId, locationId),
      ),
    )
    .returning();

  if (!row) {
    const err = new Error("Bill not found");
    err.statusCode = 404;
    throw err;
  }

  if (lines) {
    await db
      .delete(supplierBillItems)
      .where(eq(supplierBillItems.billId, billId));

    if (lines.length > 0) {
      await db.insert(supplierBillItems).values(
        lines.map((x) => ({
          billId,
          productId: x.productId || null,
          description: x.description,
          qty: x.qty,
          unitCost: x.unitCost,
          lineTotal: x.lineTotal,
        })),
      );
    }
  }

  await safeLogAudit({
    locationId,
    userId: actorUser?.id || null,
    action: AUDIT.SUPPLIER_BILL_UPDATE,
    entity: "supplier_bill",
    entityId: row.id,
    description: `Updated supplier bill #${row.id}`,
    meta: {
      supplierId: row.supplierId,
      purchaseOrderId: row.purchaseOrderId || null,
      goodsReceiptId: row.goodsReceiptId || null,
      status: row.status,
      totalAmount: row.totalAmount,
      paidAmount: row.paidAmount,
    },
  });

  return row;
}

async function deleteSupplierBill({ id, actorUser }) {
  const billId = Number(id);
  const locationId = Number(actorUser?.locationId);

  if (!Number.isInteger(billId) || billId <= 0) {
    const err = new Error("Invalid bill id");
    err.statusCode = 400;
    throw err;
  }

  if (!Number.isInteger(locationId) || locationId <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const bill = await getScopedBillOrThrow({ billId, locationId });

  if (Number(bill.paidAmount || 0) > 0) {
    const err = new Error("Bill already has payment history. Void is blocked.");
    err.statusCode = 409;
    throw err;
  }

  const [row] = await db
    .update(supplierBills)
    .set({
      status: "VOID",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(supplierBills.id, billId),
        eq(supplierBills.locationId, locationId),
      ),
    )
    .returning();

  if (!row) {
    const err = new Error("Bill not found");
    err.statusCode = 404;
    throw err;
  }

  await safeLogAudit({
    locationId,
    userId: actorUser?.id || null,
    action: AUDIT.SUPPLIER_BILL_VOID,
    entity: "supplier_bill",
    entityId: row.id,
    description: `Voided supplier bill #${row.id}`,
    meta: {
      supplierId: row.supplierId,
      purchaseOrderId: row.purchaseOrderId || null,
      goodsReceiptId: row.goodsReceiptId || null,
      status: row.status,
    },
  });

  return { bill: row };
}

async function createSupplierBillPayment({ id, actorUser, payload }) {
  const billId = Number(id);
  const locationId = Number(actorUser?.locationId);

  if (!Number.isInteger(billId) || billId <= 0) {
    const err = new Error("Invalid bill id");
    err.statusCode = 400;
    throw err;
  }

  if (!Number.isInteger(locationId) || locationId <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const parsed = supplierBillPaymentCreateSchema.safeParse(payload || {});
  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const data = parsed.data;
  const amount = moneyInt(data.amount);

  if (!Number.isInteger(amount) || amount <= 0) {
    const err = new Error("Invalid amount");
    err.statusCode = 400;
    throw err;
  }

  const createdByUserId = actorUser?.id ? Number(actorUser.id) : null;

  const result = await db.transaction(async (tx) => {
    const bill = await getScopedBillOrThrow({ billId, locationId, tx });

    const currentStatus = String(bill.status || "").toUpperCase();
    if (currentStatus === "VOID") {
      const err = new Error("Bill is VOID");
      err.statusCode = 409;
      throw err;
    }
    if (currentStatus === "PAID") {
      const err = new Error("Bill is already fully paid");
      err.statusCode = 409;
      throw err;
    }

    const total = Number(bill.totalAmount || 0);
    const paid = Number(bill.paidAmount || 0);
    const balance = Math.max(0, total - paid);

    if (amount > balance) {
      const err = new Error(`Payment exceeds balance (${balance}).`);
      err.statusCode = 409;
      throw err;
    }

    const [payment] = await tx
      .insert(supplierBillPayments)
      .values({
        billId,
        amount,
        method: normalizeMethod(data.method, "BANK"),
        reference: cleanStr(data.reference),
        note: cleanStr(data.note),
        paidAt: cleanStr(data.paidAt) || undefined,
        createdByUserId,
      })
      .returning();

    const newPaid = paid + amount;
    const newStatus = deriveBillStatus({
      totalAmount: total,
      paidAmount: newPaid,
      requestedStatus: currentStatus,
    });

    await tx
      .update(supplierBills)
      .set({
        paidAmount: newPaid,
        status: newStatus,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(supplierBills.id, billId),
          eq(supplierBills.locationId, locationId),
        ),
      );

    return {
      payment,
      bill: {
        id: billId,
        paidAmount: newPaid,
        balance: Math.max(0, total - newPaid),
        status: newStatus,
      },
      auditMeta: {
        supplierId: bill.supplierId,
        purchaseOrderId: bill.purchaseOrderId || null,
        goodsReceiptId: bill.goodsReceiptId || null,
        amount,
        newPaid,
        balance: Math.max(0, total - newPaid),
        status: newStatus,
      },
    };
  });

  await safeLogAudit({
    locationId,
    userId: createdByUserId,
    action: AUDIT.SUPPLIER_BILL_PAYMENT_CREATE,
    entity: "supplier_bill",
    entityId: billId,
    description: `Recorded payment on supplier bill #${billId}`,
    meta: result.auditMeta,
  });

  return {
    payment: result.payment,
    bill: result.bill,
  };
}

async function supplierSummary({ locationId, supplierId }) {
  const lid = Number(locationId);
  if (!Number.isInteger(lid) || lid <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const sid = supplierId ? Number(supplierId) : null;
  const where = [
    eq(supplierBills.locationId, lid),
    sql`${supplierBills.status} <> 'VOID'`,
  ];

  if (sid && Number.isInteger(sid) && sid > 0) {
    where.push(eq(supplierBills.supplierId, sid));
  }

  const rows = await db
    .select({
      billsCount: sql`count(*)::int`.as("billsCount"),
      totalAmount: sql`coalesce(sum(${supplierBills.totalAmount}), 0)::int`.as(
        "totalAmount",
      ),
      paidAmount: sql`coalesce(sum(${supplierBills.paidAmount}), 0)::int`.as(
        "paidAmount",
      ),
      openBillsCount:
        sql`count(*) filter (where ${supplierBills.status} = 'OPEN')::int`.as(
          "openBillsCount",
        ),
      partiallyPaidCount:
        sql`count(*) filter (where ${supplierBills.status} = 'PARTIALLY_PAID')::int`.as(
          "partiallyPaidCount",
        ),
      paidBillsCount:
        sql`count(*) filter (where ${supplierBills.status} = 'PAID')::int`.as(
          "paidBillsCount",
        ),
      overdueBillsCount: sql`count(*) filter (
        where ${supplierBills.dueDate} is not null
          and ${supplierBills.dueDate} < CURRENT_DATE
          and ${supplierBills.status} not in ('PAID', 'VOID')
      )::int`.as("overdueBillsCount"),
      overdueAmount: sql`coalesce(sum(
        case
          when ${supplierBills.dueDate} is not null
           and ${supplierBills.dueDate} < CURRENT_DATE
           and ${supplierBills.status} not in ('PAID', 'VOID')
          then greatest(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)
          else 0
        end
      ), 0)::int`.as("overdueAmount"),
    })
    .from(supplierBills)
    .where(and(...where));

  const r = rows?.[0] || {
    billsCount: 0,
    totalAmount: 0,
    paidAmount: 0,
    openBillsCount: 0,
    partiallyPaidCount: 0,
    paidBillsCount: 0,
    overdueBillsCount: 0,
    overdueAmount: 0,
  };

  const balance = Math.max(
    0,
    Number(r.totalAmount || 0) - Number(r.paidAmount || 0),
  );

  return {
    billsCount: Number(r.billsCount || 0),
    totalAmount: Number(r.totalAmount || 0),
    paidAmount: Number(r.paidAmount || 0),
    balance,
    openBillsCount: Number(r.openBillsCount || 0),
    partiallyPaidCount: Number(r.partiallyPaidCount || 0),
    paidBillsCount: Number(r.paidBillsCount || 0),
    overdueBillsCount: Number(r.overdueBillsCount || 0),
    overdueAmount: Number(r.overdueAmount || 0),
  };
}

module.exports = {
  listSupplierBills,
  getSupplierBill,
  createSupplierBill,
  updateSupplierBill,
  deleteSupplierBill,
  createSupplierBillPayment,
  supplierSummary,
};
