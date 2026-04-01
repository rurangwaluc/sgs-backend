"use strict";

const { and, desc, eq, sql } = require("drizzle-orm");

const { db } = require("../config/db");
const { suppliers } = require("../db/schema/suppliers.schema");
const {
  supplierBills,
  supplierBillItems,
  supplierBillPayments,
} = require("../db/schema/supplier_bills.schema");
const { locations } = require("../db/schema/locations.schema");
const { users } = require("../db/schema/users.schema");

function toInt(v, dflt = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || "";
}

async function listOwnerSupplierBills({
  locationId,
  supplierId,
  status,
  q,
  limit = 100,
  offset = 0,
} = {}) {
  const locId = toInt(locationId, null);
  const supId = toInt(supplierId, null);
  const st = cleanStr(status).toUpperCase();
  const query = cleanStr(q);
  const lim = Math.max(1, Math.min(200, toInt(limit, 100) || 100));
  const off = Math.max(0, toInt(offset, 0) || 0);

  const where = [];

  if (locId) {
    where.push(eq(supplierBills.locationId, locId));
  }

  if (supId) {
    where.push(eq(supplierBills.supplierId, supId));
  }

  if (st) {
    where.push(eq(supplierBills.status, st));
  }

  if (query) {
    const like = `%${query}%`;
    where.push(sql`(
      ${suppliers.name} ILIKE ${like}
      OR ${supplierBills.billNo} ILIKE ${like}
      OR ${supplierBills.note} ILIKE ${like}
      OR ${locations.name} ILIKE ${like}
      OR ${locations.code} ILIKE ${like}
    )`);
  }

  const rows = await db
    .select({
      id: supplierBills.id,
      locationId: supplierBills.locationId,
      locationName: locations.name,
      locationCode: locations.code,

      supplierId: supplierBills.supplierId,
      supplierName: suppliers.name,
      supplierDefaultCurrency: suppliers.defaultCurrency,

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
      createdByName: users.name,

      createdAt: supplierBills.createdAt,
      updatedAt: supplierBills.updatedAt,

      isOverdue: sql`
        CASE
          WHEN ${supplierBills.status} IN ('PAID', 'VOID') THEN false
          WHEN ${supplierBills.dueDate} IS NULL THEN false
          WHEN ${supplierBills.dueDate} < CURRENT_DATE THEN true
          ELSE false
        END
      `.as("isOverdue"),

      daysOverdue: sql`
        CASE
          WHEN ${supplierBills.status} IN ('PAID', 'VOID') THEN 0
          WHEN ${supplierBills.dueDate} IS NULL THEN 0
          WHEN ${supplierBills.dueDate} < CURRENT_DATE
            THEN (CURRENT_DATE - ${supplierBills.dueDate})::int
          ELSE 0
        END
      `.as("daysOverdue"),
    })
    .from(supplierBills)
    .leftJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .leftJoin(locations, eq(locations.id, supplierBills.locationId))
    .leftJoin(users, eq(users.id, supplierBills.createdByUserId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(supplierBills.createdAt), desc(supplierBills.id))
    .limit(lim)
    .offset(off);

  return rows || [];
}

async function getOwnerSupplierBillsSummary({
  locationId,
  supplierId,
  status,
  q,
} = {}) {
  const locId = toInt(locationId, null);
  const supId = toInt(supplierId, null);
  const st = cleanStr(status).toUpperCase();
  const query = cleanStr(q);

  const where = [];

  if (locId) {
    where.push(eq(supplierBills.locationId, locId));
  }

  if (supId) {
    where.push(eq(supplierBills.supplierId, supId));
  }

  if (st) {
    where.push(eq(supplierBills.status, st));
  }

  if (query) {
    const like = `%${query}%`;
    where.push(sql`(
      ${suppliers.name} ILIKE ${like}
      OR ${supplierBills.billNo} ILIKE ${like}
      OR ${supplierBills.note} ILIKE ${like}
      OR ${locations.name} ILIKE ${like}
      OR ${locations.code} ILIKE ${like}
    )`);
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
      balanceAmount: sql`coalesce(sum(
        greatest(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)
      ), 0)::int`.as("balanceAmount"),

      partiallyPaidCount: sql`count(*) filter (
        where ${supplierBills.status} = 'PARTIALLY_PAID'
      )::int`.as("partiallyPaidCount"),

      overdueBillsCount: sql`count(*) filter (
        where ${supplierBills.status} not in ('PAID', 'VOID')
          and ${supplierBills.dueDate} is not null
          and ${supplierBills.dueDate} < CURRENT_DATE
      )::int`.as("overdueBillsCount"),

      overdueAmount: sql`coalesce(sum(
        case
          when ${supplierBills.status} not in ('PAID', 'VOID')
           and ${supplierBills.dueDate} is not null
           and ${supplierBills.dueDate} < CURRENT_DATE
          then greatest(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)
          else 0
        end
      ), 0)::int`.as("overdueAmount"),

      balanceRWF: sql`coalesce(sum(
        case
          when upper(coalesce(${supplierBills.currency}, 'RWF')) = 'RWF'
          then greatest(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)
          else 0
        end
      ), 0)::int`.as("balanceRWF"),

      balanceUSD: sql`coalesce(sum(
        case
          when upper(coalesce(${supplierBills.currency}, 'RWF')) = 'USD'
          then greatest(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)
          else 0
        end
      ), 0)::int`.as("balanceUSD"),

      overdueRWF: sql`coalesce(sum(
        case
          when upper(coalesce(${supplierBills.currency}, 'RWF')) = 'RWF'
           and ${supplierBills.status} not in ('PAID', 'VOID')
           and ${supplierBills.dueDate} is not null
           and ${supplierBills.dueDate} < CURRENT_DATE
          then greatest(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)
          else 0
        end
      ), 0)::int`.as("overdueRWF"),

      overdueUSD: sql`coalesce(sum(
        case
          when upper(coalesce(${supplierBills.currency}, 'RWF')) = 'USD'
           and ${supplierBills.status} not in ('PAID', 'VOID')
           and ${supplierBills.dueDate} is not null
           and ${supplierBills.dueDate} < CURRENT_DATE
          then greatest(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)
          else 0
        end
      ), 0)::int`.as("overdueUSD"),
    })
    .from(supplierBills)
    .leftJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .leftJoin(locations, eq(locations.id, supplierBills.locationId))
    .where(where.length ? and(...where) : undefined);

  return (
    rows?.[0] || {
      billsCount: 0,
      totalAmount: 0,
      paidAmount: 0,
      balanceAmount: 0,
      partiallyPaidCount: 0,
      overdueBillsCount: 0,
      overdueAmount: 0,
      balanceRWF: 0,
      balanceUSD: 0,
      overdueRWF: 0,
      overdueUSD: 0,
    }
  );
}

async function getOwnerSupplierBillById(id) {
  const billId = toInt(id, null);
  if (!billId) return null;

  const billRows = await db
    .select({
      id: supplierBills.id,
      locationId: supplierBills.locationId,
      locationName: locations.name,
      locationCode: locations.code,

      supplierId: supplierBills.supplierId,
      supplierName: suppliers.name,
      supplierDefaultCurrency: suppliers.defaultCurrency,

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
      createdByName: users.name,

      createdAt: supplierBills.createdAt,
      updatedAt: supplierBills.updatedAt,
    })
    .from(supplierBills)
    .leftJoin(suppliers, eq(suppliers.id, supplierBills.supplierId))
    .leftJoin(locations, eq(locations.id, supplierBills.locationId))
    .leftJoin(users, eq(users.id, supplierBills.createdByUserId))
    .where(eq(supplierBills.id, billId))
    .limit(1);

  const bill = billRows?.[0] || null;
  if (!bill) return null;

  const items = await db
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
    .orderBy(desc(supplierBillItems.id));

  const payments = await db
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
    .orderBy(desc(supplierBillPayments.paidAt), desc(supplierBillPayments.id));

  return {
    bill,
    items: items || [],
    payments: payments || [],
  };
}

module.exports = {
  listOwnerSupplierBills,
  getOwnerSupplierBillsSummary,
  getOwnerSupplierBillById,
};
