"use strict";

const { eq, sql } = require("drizzle-orm");

const { db } = require("../config/db");
const AUDIT = require("../audit/actions");
const { safeLogAudit } = require("./auditService");
const { suppliers } = require("../db/schema/suppliers.schema");
const {
  supplierBills,
  supplierBillItems,
  supplierBillPayments,
} = require("../db/schema/supplier_bills.schema");
const { locations } = require("../db/schema/locations.schema");
const { users } = require("../db/schema/users.schema");
const {
  supplierBillCreateSchema,
  supplierBillUpdateSchema,
  supplierBillPaymentCreateSchema,
} = require("../validators/supplierBills.schema");

function toInt(v, dflt = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

function normalizeCurrency(v, fallback = "RWF") {
  return (
    String(v || fallback)
      .trim()
      .toUpperCase()
      .slice(0, 8) || fallback
  );
}

function normalizeMethod(v, fallback = "BANK") {
  return (
    String(v || fallback)
      .trim()
      .toUpperCase()
      .slice(0, 20) || fallback
  );
}

function normalizeStatus(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

function parseDateOrNull(v) {
  const s = cleanStr(v);
  return s || null;
}

function toDateOrNull(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      const err = new Error("Invalid paidAt");
      err.code = "BAD_DATE";
      err.statusCode = 400;
      throw err;
    }
    return value;
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    const err = new Error("Invalid paidAt");
    err.code = "BAD_DATE";
    err.statusCode = 400;
    throw err;
  }

  return date;
}

function moneyInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function billStatusFromAmounts(total, paid, currentStatus = null) {
  const t = Math.max(0, toInt(total, 0) || 0);
  const p = Math.max(0, toInt(paid, 0) || 0);
  const current = normalizeStatus(currentStatus);

  if (current === "VOID") return "VOID";
  if (current === "DRAFT" && p <= 0) return "DRAFT";
  if (t <= 0) return "PAID";
  if (p <= 0) return "OPEN";
  if (p >= t) return "PAID";
  return "PARTIALLY_PAID";
}

function computeTotalsFromItems(items) {
  const clean = Array.isArray(items) ? items : [];

  const lines = clean.map((it) => {
    const qty = Math.max(0, Math.trunc(Number(it?.qty) || 0));
    const unitCost = Math.max(0, Math.trunc(Number(it?.unitCost) || 0));
    const lineTotal = qty * unitCost;

    return {
      productId:
        it?.productId != null
          ? Math.trunc(Number(it.productId) || 0) || null
          : null,
      description: String(it?.description || "").trim() || "Item",
      qty,
      unitCost,
      lineTotal,
    };
  });

  const totalAmount = lines.reduce(
    (sum, row) => sum + (Number(row.lineTotal) || 0),
    0,
  );

  return { totalAmount, lines };
}

function formatYmd(dateLike = new Date()) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function padSeq(n, width = 4) {
  return String(Math.max(1, Number(n) || 1)).padStart(width, "0");
}

function normalizeCodePart(value, fallback = "MAIN") {
  const s = String(value || fallback)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || fallback;
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
    .where(eq(locations.id, locationId))
    .limit(1);

  const location = rows?.[0] || null;
  if (!location) {
    const err = new Error("Branch not found");
    err.code = "LOCATION_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  return location;
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
    .where(eq(suppliers.id, supplierId))
    .limit(1);

  const supplier = rows?.[0] || null;
  if (!supplier) {
    const err = new Error("Supplier not found");
    err.code = "SUPPLIER_NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  if (!supplier.isActive) {
    const err = new Error("Supplier is inactive");
    err.code = "SUPPLIER_INACTIVE";
    err.statusCode = 409;
    throw err;
  }

  return supplier;
}

async function getBillOrThrow(tx, billId) {
  const rows = await tx
    .select({
      id: supplierBills.id,
      locationId: supplierBills.locationId,
      supplierId: supplierBills.supplierId,
      billNo: supplierBills.billNo,
      currency: supplierBills.currency,
      totalAmount: supplierBills.totalAmount,
      paidAmount: supplierBills.paidAmount,
      status: supplierBills.status,
      issuedDate: supplierBills.issuedDate,
      dueDate: supplierBills.dueDate,
      note: supplierBills.note,
      createdByUserId: supplierBills.createdByUserId,
      createdAt: supplierBills.createdAt,
      updatedAt: supplierBills.updatedAt,
    })
    .from(supplierBills)
    .where(eq(supplierBills.id, billId))
    .limit(1);

  const bill = rows?.[0] || null;
  if (!bill) {
    const err = new Error("Supplier bill not found");
    err.code = "NOT_FOUND";
    err.statusCode = 404;
    throw err;
  }

  return bill;
}

async function getOwnerSupplierBillById(tx, billId) {
  const billRows = await tx
    .select({
      id: supplierBills.id,
      locationId: supplierBills.locationId,
      locationName: locations.name,
      locationCode: locations.code,

      supplierId: supplierBills.supplierId,
      supplierName: suppliers.name,
      supplierDefaultCurrency: suppliers.defaultCurrency,

      createdByName: users.name,

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
          WHEN ${supplierBills.status} NOT IN ('PAID', 'VOID')
           AND ${supplierBills.dueDate} IS NOT NULL
           AND ${supplierBills.dueDate} < CURRENT_DATE
          THEN true
          ELSE false
        END
      `.as("isOverdue"),

      daysOverdue: sql`
        CASE
          WHEN ${supplierBills.status} NOT IN ('PAID', 'VOID')
           AND ${supplierBills.dueDate} IS NOT NULL
           AND ${supplierBills.dueDate} < CURRENT_DATE
          THEN (CURRENT_DATE - ${supplierBills.dueDate})::int
          ELSE 0
        END
      `.as("daysOverdue"),
    })
    .from(supplierBills)
    .leftJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .leftJoin(locations, eq(locations.id, supplierBills.locationId))
    .leftJoin(users, eq(users.id, supplierBills.createdByUserId))
    .where(eq(supplierBills.id, billId))
    .limit(1);

  const bill = billRows?.[0] || null;
  if (!bill) return null;

  const items = await tx
    .select({
      id: supplierBillItems.id,
      billId: supplierBillItems.billId,
      productId: supplierBillItems.productId,
      description: supplierBillItems.description,
      qty: supplierBillItems.qty,
      unitCost: supplierBillItems.unitCost,
      lineTotal: supplierBillItems.lineTotal,
      createdAt: supplierBillItems.createdAt,
    })
    .from(supplierBillItems)
    .where(eq(supplierBillItems.billId, billId))
    .orderBy(supplierBillItems.id);

  const payments = await tx
    .select({
      id: supplierBillPayments.id,
      billId: supplierBillPayments.billId,
      amount: supplierBillPayments.amount,
      method: supplierBillPayments.method,
      reference: supplierBillPayments.reference,
      note: supplierBillPayments.note,
      paidAt: supplierBillPayments.paidAt,
      createdByUserId: supplierBillPayments.createdByUserId,
      createdByName: users.name,
      createdAt: supplierBillPayments.createdAt,
    })
    .from(supplierBillPayments)
    .leftJoin(users, eq(users.id, supplierBillPayments.createdByUserId))
    .where(eq(supplierBillPayments.billId, billId))
    .orderBy(
      sql`${supplierBillPayments.paidAt} DESC`,
      sql`${supplierBillPayments.id} DESC`,
    );

  return {
    bill,
    items: items || [],
    payments: payments || [],
  };
}

async function generateNextSupplierBillNo(
  tx,
  { locationId, issuedDate = null },
) {
  const location = await getLocationOrThrow(tx, locationId);
  const datePart = formatYmd(issuedDate || new Date());
  const locationCode = normalizeCodePart(
    location.code || location.name || "MAIN",
  );
  const prefix = `BILL-${locationCode}-${datePart}-`;

  const rows = await tx.execute(sql`
    SELECT sb.bill_no as "billNo"
    FROM supplier_bills sb
    WHERE sb.location_id = ${Number(locationId)}
      AND sb.bill_no ILIKE ${`${prefix}%`}
    ORDER BY sb.id DESC
    LIMIT 500
  `);

  const existing = rows?.rows || rows || [];
  let maxSeq = 0;

  for (const row of existing) {
    const billNo = String(row?.billNo || "");
    const match = billNo.match(/(\d+)$/);
    if (!match) continue;
    const seq = Number(match[1]);
    if (Number.isFinite(seq) && seq > maxSeq) {
      maxSeq = seq;
    }
  }

  return `${prefix}${padSeq(maxSeq + 1, 4)}`;
}

async function generateNextSupplierBillPaymentReference(
  tx,
  { billId, method = "BANK", billNo = null },
) {
  const methodCode = normalizeCodePart(method || "BANK", "BANK");
  const baseBillNo = normalizeCodePart(
    billNo || `BILL-${billId}`,
    `BILL-${billId}`,
  );

  const rows = await tx.execute(sql`
    SELECT COUNT(*)::int as count
    FROM supplier_bill_payments
    WHERE bill_id = ${Number(billId)}
  `);

  const existingCount = Number((rows?.rows || rows || [])[0]?.count || 0);
  return `${methodCode}-PAY-${baseBillNo}-${padSeq(existingCount + 1, 3)}`;
}

async function createOwnerSupplierBill({
  ownerUserId,
  ownerLocationId,
  payload,
}) {
  const parsed = supplierBillCreateSchema.safeParse(payload || {});
  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const data = parsed.data;
  const supplierId = toInt(data.supplierId, null);
  const locationId = toInt(data.locationId, ownerLocationId || null);

  if (!supplierId || supplierId <= 0) {
    const err = new Error("Invalid supplier id");
    err.code = "BAD_SUPPLIER_ID";
    err.statusCode = 400;
    throw err;
  }

  if (!locationId || locationId <= 0) {
    const err = new Error("Invalid location id");
    err.code = "BAD_LOCATION_ID";
    err.statusCode = 400;
    throw err;
  }

  return db.transaction(async (tx) => {
    const supplier = await getSupplierOrThrow(tx, supplierId);
    await getLocationOrThrow(tx, locationId);

    let totalAmount = 0;
    let lines = [];

    if (Array.isArray(data.items) && data.items.length > 0) {
      const computed = computeTotalsFromItems(data.items);
      totalAmount = computed.totalAmount;
      lines = computed.lines;
    } else {
      totalAmount = Math.max(0, toInt(data.totalAmount, 0) || 0);
    }

    if (totalAmount <= 0) {
      const err = new Error("totalAmount must be greater than zero");
      err.code = "BAD_TOTAL";
      err.statusCode = 400;
      throw err;
    }

    const paidAmount = 0;
    const requestedStatus = normalizeStatus(data.status || "OPEN");
    const status =
      requestedStatus === "DRAFT"
        ? "DRAFT"
        : billStatusFromAmounts(totalAmount, paidAmount, requestedStatus);

    const currency = normalizeCurrency(
      data.currency,
      supplier?.defaultCurrency || "RWF",
    );

    const issuedDateValue = toDateOrNull(data.issuedDate) || new Date();
    const autoBillNo = await generateNextSupplierBillNo(tx, {
      locationId,
      issuedDate: issuedDateValue,
    });

    const finalBillNo = cleanStr(data.billNo) || autoBillNo;

    const [created] = await tx
      .insert(supplierBills)
      .values({
        locationId,
        supplierId,
        billNo: finalBillNo,
        currency,
        totalAmount,
        paidAmount: 0,
        status,
        issuedDate: issuedDateValue,
        dueDate: toDateOrNull(data.dueDate),
        note: cleanStr(data.note),
        createdByUserId: ownerUserId,
        createdAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .returning({ id: supplierBills.id });

    const billId = created?.id;

    if (!billId) {
      const err = new Error("Failed to create supplier bill");
      err.code = "CREATE_FAILED";
      err.statusCode = 500;
      throw err;
    }

    if (lines.length > 0) {
      await tx.insert(supplierBillItems).values(
        lines.map((line) => ({
          billId,
          productId: line.productId,
          description: line.description,
          qty: line.qty,
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
        })),
      );
    }

    await safeLogAudit({
      locationId,
      userId: ownerUserId,
      action: AUDIT.OWNER_SUPPLIER_BILL_CREATE,
      entity: "supplier_bill",
      entityId: billId,
      description: `Owner created supplier bill #${billId}`,
      meta: {
        supplierId,
        totalAmount,
        currency,
        status,
        billNo: finalBillNo,
      },
      tx,
    });

    return getOwnerSupplierBillById(tx, billId);
  });
}

async function updateOwnerSupplierBill({ ownerUserId, billId, payload }) {
  const id = toInt(billId, null);
  if (!id) {
    const err = new Error("Invalid bill id");
    err.code = "BAD_BILL_ID";
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

  return db.transaction(async (tx) => {
    const existing = await getBillOrThrow(tx, id);

    if (normalizeStatus(existing.status) === "VOID") {
      const err = new Error("VOID bill cannot be updated");
      err.code = "VOID_LOCKED";
      err.statusCode = 409;
      throw err;
    }

    const patch = {};
    const hasItems = Array.isArray(data.items);
    let recomputedTotal = null;
    let recomputedLines = null;

    if (data.supplierId !== undefined) {
      const nextSupplierId = toInt(data.supplierId, null);
      if (!nextSupplierId) {
        const err = new Error("Invalid supplier id");
        err.code = "BAD_SUPPLIER_ID";
        err.statusCode = 400;
        throw err;
      }

      await getSupplierOrThrow(tx, nextSupplierId);
      patch.supplierId = nextSupplierId;
    }

    if (data.locationId !== undefined) {
      const nextLocationId = toInt(data.locationId, null);
      if (!nextLocationId) {
        const err = new Error("Invalid location id");
        err.code = "BAD_LOCATION_ID";
        err.statusCode = 400;
        throw err;
      }

      await getLocationOrThrow(tx, nextLocationId);
      patch.locationId = nextLocationId;
    }

    if (data.billNo !== undefined) {
      patch.billNo = cleanStr(data.billNo);
    }

    if (data.currency !== undefined) {
      patch.currency = normalizeCurrency(
        data.currency,
        existing.currency || "RWF",
      );
    }

    if (data.issuedDate !== undefined) {
      patch.issuedDate = toDateOrNull(data.issuedDate);
    }

    if (data.dueDate !== undefined) {
      patch.dueDate = toDateOrNull(data.dueDate);
    }

    if (data.note !== undefined) {
      patch.note = cleanStr(data.note);
    }

    if (data.totalAmount !== undefined && !hasItems) {
      const total = Math.max(0, toInt(data.totalAmount, 0) || 0);
      if (total <= 0) {
        const err = new Error("totalAmount must be greater than zero");
        err.code = "BAD_TOTAL";
        err.statusCode = 400;
        throw err;
      }
      recomputedTotal = total;
    }

    if (hasItems) {
      const computed = computeTotalsFromItems(data.items);
      if (computed.totalAmount <= 0) {
        const err = new Error(
          "items must produce totalAmount greater than zero",
        );
        err.code = "BAD_ITEMS";
        err.statusCode = 400;
        throw err;
      }
      recomputedTotal = computed.totalAmount;
      recomputedLines = computed.lines;
    }

    const currentPaid = Math.max(0, Number(existing.paidAmount || 0));
    if (recomputedTotal != null && currentPaid > recomputedTotal) {
      const err = new Error("paid amount cannot exceed updated total amount");
      err.code = "PAID_EXCEEDS_TOTAL";
      err.statusCode = 409;
      throw err;
    }

    const requestedStatus =
      data.status !== undefined ? normalizeStatus(data.status) : null;

    if (recomputedTotal != null) {
      patch.totalAmount = recomputedTotal;
    }

    const nextTotal =
      recomputedTotal != null
        ? recomputedTotal
        : Math.max(0, Number(existing.totalAmount || 0));

    const derivedStatus = billStatusFromAmounts(
      nextTotal,
      currentPaid,
      requestedStatus || existing.status,
    );

    if (requestedStatus === "VOID") {
      const err = new Error("Use void action instead of update status VOID");
      err.code = "USE_VOID_ACTION";
      err.statusCode = 409;
      throw err;
    }

    patch.status =
      requestedStatus === "DRAFT" && currentPaid <= 0 ? "DRAFT" : derivedStatus;

    await tx
      .update(supplierBills)
      .set({
        ...(patch.supplierId !== undefined
          ? { supplierId: patch.supplierId }
          : {}),
        ...(patch.locationId !== undefined
          ? { locationId: patch.locationId }
          : {}),
        ...(patch.billNo !== undefined ? { billNo: patch.billNo } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.totalAmount !== undefined
          ? { totalAmount: patch.totalAmount }
          : {}),
        ...(patch.issuedDate !== undefined
          ? { issuedDate: patch.issuedDate }
          : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.note !== undefined ? { note: patch.note } : {}),
        status: patch.status,
        updatedAt: sql`now()`,
      })
      .where(eq(supplierBills.id, id));

    if (recomputedLines) {
      await tx
        .delete(supplierBillItems)
        .where(eq(supplierBillItems.billId, id));

      if (recomputedLines.length > 0) {
        await tx.insert(supplierBillItems).values(
          recomputedLines.map((line) => ({
            billId: id,
            productId: line.productId,
            description: line.description,
            qty: line.qty,
            unitCost: line.unitCost,
            lineTotal: line.lineTotal,
          })),
        );
      }
    }

    await safeLogAudit({
      locationId: patch.locationId ?? existing.locationId,
      userId: ownerUserId,
      action: AUDIT.OWNER_SUPPLIER_BILL_UPDATE,
      entity: "supplier_bill",
      entityId: id,
      description: `Owner updated supplier bill #${id}`,
      meta: {
        supplierId: patch.supplierId ?? existing.supplierId,
        totalAmount: patch.totalAmount ?? existing.totalAmount,
        status: patch.status,
        billNo: patch.billNo ?? existing.billNo,
      },
      tx,
    });

    return getOwnerSupplierBillById(tx, id);
  });
}

async function addOwnerSupplierBillPayment({ ownerUserId, billId, payload }) {
  const id = toInt(billId, null);
  if (!id) {
    const err = new Error("Invalid bill id");
    err.code = "BAD_BILL_ID";
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
  const amount = Math.max(0, toInt(data.amount, 0) || 0);

  if (amount <= 0) {
    const err = new Error("Amount must be greater than zero");
    err.code = "BAD_AMOUNT";
    err.statusCode = 400;
    throw err;
  }

  return db.transaction(async (tx) => {
    const existing = await getBillOrThrow(tx, id);
    const currentStatus = normalizeStatus(existing.status);

    if (currentStatus === "VOID") {
      const err = new Error("Cannot pay a VOID bill");
      err.code = "VOID_LOCKED";
      err.statusCode = 409;
      throw err;
    }

    const total = Math.max(0, Number(existing.totalAmount || 0));
    const paid = Math.max(0, Number(existing.paidAmount || 0));
    const balance = Math.max(0, total - paid);

    if (balance <= 0) {
      const err = new Error("Bill is already fully paid");
      err.code = "ALREADY_PAID";
      err.statusCode = 409;
      throw err;
    }

    if (amount > balance) {
      const err = new Error(`Payment exceeds remaining balance ${balance}`);
      err.code = "EXCEEDS_BALANCE";
      err.statusCode = 409;
      throw err;
    }

    const paidAt = toDateOrNull(data.paidAt) || new Date();

    const [payment] = await tx
      .insert(supplierBillPayments)
      .values({
        billId: id,
        amount,
        method: normalizeMethod(data.method, "BANK"),
        reference: cleanStr(data.reference),
        note: cleanStr(data.note),
        paidAt,
        createdByUserId: ownerUserId,
        createdAt: sql`now()`,
      })
      .returning({ id: supplierBillPayments.id });

    const nextPaid = paid + amount;
    const nextStatus = billStatusFromAmounts(total, nextPaid, existing.status);

    await tx
      .update(supplierBills)
      .set({
        paidAmount: nextPaid,
        status: nextStatus,
        updatedAt: sql`now()`,
      })
      .where(eq(supplierBills.id, id));

    await safeLogAudit({
      locationId: existing.locationId,
      userId: ownerUserId,
      action: AUDIT.OWNER_SUPPLIER_BILL_PAYMENT_CREATE,
      entity: "supplier_bill",
      entityId: id,
      description: `Owner recorded supplier bill payment on bill #${id}`,
      meta: {
        supplierId: existing.supplierId,
        amount,
        paidAmount: nextPaid,
        balance: Math.max(0, total - nextPaid),
        status: nextStatus,
        paymentId: payment?.id || null,
      },
      tx,
    });

    return getOwnerSupplierBillById(tx, id);
  });
}

async function voidOwnerSupplierBill({ ownerUserId, billId, reason }) {
  const id = toInt(billId, null);
  if (!id) {
    const err = new Error("Invalid bill id");
    err.code = "BAD_BILL_ID";
    err.statusCode = 400;
    throw err;
  }

  return db.transaction(async (tx) => {
    const existing = await getBillOrThrow(tx, id);
    const currentStatus = normalizeStatus(existing.status);

    if (currentStatus === "VOID") {
      return getOwnerSupplierBillById(tx, id);
    }

    const paid = Math.max(0, Number(existing.paidAmount || 0));
    if (paid > 0) {
      const err = new Error("Cannot void a bill that already has payments");
      err.code = "HAS_PAYMENTS";
      err.statusCode = 409;
      throw err;
    }

    const nextNote = [cleanStr(existing.note), cleanStr(reason)]
      .filter(Boolean)
      .join(" | ");

    await tx
      .update(supplierBills)
      .set({
        status: "VOID",
        note: nextNote || existing.note,
        updatedAt: sql`now()`,
      })
      .where(eq(supplierBills.id, id));

    await safeLogAudit({
      locationId: existing.locationId,
      userId: ownerUserId,
      action: AUDIT.OWNER_SUPPLIER_BILL_VOID,
      entity: "supplier_bill",
      entityId: id,
      description: `Owner voided supplier bill #${id}`,
      meta: {
        supplierId: existing.supplierId,
        reason: cleanStr(reason),
      },
      tx,
    });

    return getOwnerSupplierBillById(tx, id);
  });
}

module.exports = {
  createOwnerSupplierBill,
  updateOwnerSupplierBill,
  addOwnerSupplierBillPayment,
  voidOwnerSupplierBill,
};
