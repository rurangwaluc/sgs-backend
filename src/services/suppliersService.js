"use strict";

const { and, desc, eq, ilike, or, sql } = require("drizzle-orm");

const { db } = require("../config/db");
const AUDIT = require("../audit/actions");
const { safeLogAudit } = require("./auditService");
const { suppliers } = require("../db/schema/suppliers.schema");
const { supplierBills } = require("../db/schema/supplier_bills.schema");
const {
  supplierCreateSchema,
  supplierUpdateSchema,
} = require("../validators/suppliers.schema");

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

function normalizeSourceType(v) {
  const s = String(v || "LOCAL")
    .trim()
    .toUpperCase();
  return s === "ABROAD" ? "ABROAD" : "LOCAL";
}

function normalizeCurrency(v, sourceType = "LOCAL") {
  const c = String(v || "")
    .trim()
    .toUpperCase();

  if (c === "USD" || c === "RWF") return c;
  return sourceType === "ABROAD" ? "USD" : "RWF";
}

async function getSupplierRowOrThrow(id) {
  const supplierId = toInt(id, null);
  if (!supplierId || supplierId <= 0) {
    const err = new Error("Invalid supplier id");
    err.statusCode = 400;
    throw err;
  }

  const rows = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      contactName: suppliers.contactName,
      phone: suppliers.phone,
      email: suppliers.email,
      country: suppliers.country,
      city: suppliers.city,
      sourceType: suppliers.sourceType,
      defaultCurrency: suppliers.defaultCurrency,
      address: suppliers.address,
      notes: suppliers.notes,
      isActive: suppliers.isActive,
      createdAt: suppliers.createdAt,
      updatedAt: suppliers.updatedAt,
    })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);

  const row = rows?.[0] || null;
  if (!row) {
    const err = new Error("Supplier not found");
    err.statusCode = 404;
    throw err;
  }

  return row;
}

async function listSuppliers({
  q,
  limit = 50,
  offset = 0,
  active,
  sourceType,
} = {}) {
  const query = cleanStr(q);
  const where = [];

  if (query) {
    where.push(
      or(
        ilike(suppliers.name, `%${query}%`),
        ilike(suppliers.contactName, `%${query}%`),
        ilike(suppliers.phone, `%${query}%`),
        ilike(suppliers.email, `%${query}%`),
        ilike(suppliers.country, `%${query}%`),
        ilike(suppliers.city, `%${query}%`),
      ),
    );
  }

  if (active === true) where.push(eq(suppliers.isActive, true));
  if (active === false) where.push(eq(suppliers.isActive, false));

  if (cleanStr(sourceType)) {
    where.push(
      eq(suppliers.sourceType, String(sourceType).trim().toUpperCase()),
    );
  }

  const rows = await db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      contactName: suppliers.contactName,
      phone: suppliers.phone,
      email: suppliers.email,
      country: suppliers.country,
      city: suppliers.city,
      sourceType: suppliers.sourceType,
      defaultCurrency: suppliers.defaultCurrency,
      address: suppliers.address,
      notes: suppliers.notes,
      isActive: suppliers.isActive,
      createdAt: suppliers.createdAt,
      updatedAt: suppliers.updatedAt,
    })
    .from(suppliers)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(suppliers.id))
    .limit(Math.max(1, Math.min(100, Number(limit) || 50)))
    .offset(Math.max(0, Number(offset) || 0));

  return rows || [];
}

async function createSupplier({ actorUser, payload }) {
  const parsed = supplierCreateSchema.safeParse(payload || {});
  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid supplier payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const b = parsed.data;
  const sourceType = normalizeSourceType(b.sourceType);
  const defaultCurrency = normalizeCurrency(b.defaultCurrency, sourceType);

  const rows = await db
    .insert(suppliers)
    .values({
      name: String(b.name).trim(),
      contactName: cleanStr(b.contactName),
      phone: cleanStr(b.phone),
      email: cleanStr(b.email),
      country: cleanStr(b.country),
      city: cleanStr(b.city),
      sourceType,
      defaultCurrency,
      address: cleanStr(b.address),
      notes: cleanStr(b.notes),
      isActive: b.isActive ?? true,
      updatedAt: new Date(),
    })
    .returning({
      id: suppliers.id,
      name: suppliers.name,
      contactName: suppliers.contactName,
      phone: suppliers.phone,
      email: suppliers.email,
      country: suppliers.country,
      city: suppliers.city,
      sourceType: suppliers.sourceType,
      defaultCurrency: suppliers.defaultCurrency,
      address: suppliers.address,
      notes: suppliers.notes,
      isActive: suppliers.isActive,
      createdAt: suppliers.createdAt,
      updatedAt: suppliers.updatedAt,
    });

  const supplier = rows?.[0] || null;

  if (supplier?.id && actorUser?.id) {
    await safeLogAudit({
      locationId: actorUser.locationId || null,
      userId: actorUser.id,
      action: AUDIT.SUPPLIER_CREATE,
      entity: "supplier",
      entityId: supplier.id,
      description: `Created supplier ${supplier.name}`,
      meta: {
        supplierId: supplier.id,
        sourceType: supplier.sourceType,
        defaultCurrency: supplier.defaultCurrency,
      },
    });
  }

  return supplier;
}

async function getSupplier({ id }) {
  return getSupplierRowOrThrow(id);
}

async function updateSupplier({ id, actorUser, payload }) {
  const supplierId = toInt(id, null);
  if (!supplierId || supplierId <= 0) {
    const err = new Error("Invalid supplier id");
    err.statusCode = 400;
    throw err;
  }

  const parsed = supplierUpdateSchema.safeParse(payload || {});
  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid supplier payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const current = await getSupplierRowOrThrow(supplierId);
  const b = parsed.data;

  const nextSourceType =
    b.sourceType !== undefined
      ? normalizeSourceType(b.sourceType)
      : current.sourceType;

  const patch = {
    ...(b.name !== undefined ? { name: String(b.name).trim() } : {}),
    ...(b.contactName !== undefined
      ? { contactName: cleanStr(b.contactName) }
      : {}),
    ...(b.phone !== undefined ? { phone: cleanStr(b.phone) } : {}),
    ...(b.email !== undefined ? { email: cleanStr(b.email) } : {}),
    ...(b.country !== undefined ? { country: cleanStr(b.country) } : {}),
    ...(b.city !== undefined ? { city: cleanStr(b.city) } : {}),
    ...(b.sourceType !== undefined ? { sourceType: nextSourceType } : {}),
    ...(b.defaultCurrency !== undefined
      ? {
          defaultCurrency: normalizeCurrency(b.defaultCurrency, nextSourceType),
        }
      : {}),
    ...(b.address !== undefined ? { address: cleanStr(b.address) } : {}),
    ...(b.notes !== undefined ? { notes: cleanStr(b.notes) } : {}),
    ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
    updatedAt: new Date(),
  };

  const rows = await db
    .update(suppliers)
    .set(patch)
    .where(eq(suppliers.id, supplierId))
    .returning({
      id: suppliers.id,
      name: suppliers.name,
      contactName: suppliers.contactName,
      phone: suppliers.phone,
      email: suppliers.email,
      country: suppliers.country,
      city: suppliers.city,
      sourceType: suppliers.sourceType,
      defaultCurrency: suppliers.defaultCurrency,
      address: suppliers.address,
      notes: suppliers.notes,
      isActive: suppliers.isActive,
      createdAt: suppliers.createdAt,
      updatedAt: suppliers.updatedAt,
    });

  const supplier = rows?.[0] || null;
  if (!supplier) {
    const err = new Error("Supplier not found");
    err.statusCode = 404;
    throw err;
  }

  if (supplier?.id && actorUser?.id) {
    await safeLogAudit({
      locationId: actorUser.locationId || null,
      userId: actorUser.id,
      action: AUDIT.SUPPLIER_UPDATE,
      entity: "supplier",
      entityId: supplier.id,
      description: `Updated supplier ${supplier.name}`,
      meta: {
        supplierId: supplier.id,
        sourceType: supplier.sourceType,
        defaultCurrency: supplier.defaultCurrency,
        isActive: supplier.isActive,
      },
    });
  }

  return supplier;
}

async function deleteSupplier({ id, actorUser }) {
  const supplierId = toInt(id, null);
  if (!supplierId || supplierId <= 0) {
    const err = new Error("Invalid supplier id");
    err.statusCode = 400;
    throw err;
  }

  await getSupplierRowOrThrow(supplierId);

  const rows = await db
    .update(suppliers)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, supplierId))
    .returning({
      id: suppliers.id,
      name: suppliers.name,
      contactName: suppliers.contactName,
      phone: suppliers.phone,
      email: suppliers.email,
      country: suppliers.country,
      city: suppliers.city,
      sourceType: suppliers.sourceType,
      defaultCurrency: suppliers.defaultCurrency,
      address: suppliers.address,
      notes: suppliers.notes,
      isActive: suppliers.isActive,
      createdAt: suppliers.createdAt,
      updatedAt: suppliers.updatedAt,
    });

  const supplier = rows?.[0] || null;
  if (!supplier) {
    const err = new Error("Supplier not found");
    err.statusCode = 404;
    throw err;
  }

  if (supplier?.id && actorUser?.id) {
    await safeLogAudit({
      locationId: actorUser.locationId || null,
      userId: actorUser.id,
      action: AUDIT.SUPPLIER_DEACTIVATE,
      entity: "supplier",
      entityId: supplier.id,
      description: `Deactivated supplier ${supplier.name}`,
      meta: {
        supplierId: supplier.id,
        isActive: supplier.isActive,
      },
    });
  }

  return supplier;
}

async function supplierSummary({ locationId, supplierId }) {
  const lid = toInt(locationId, null);
  if (!lid || lid <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }

  const sid = toInt(supplierId, null);
  const where = [
    eq(supplierBills.locationId, lid),
    sql`${supplierBills.status} <> 'VOID'`,
  ];

  if (sid && sid > 0) {
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
  listSuppliers,
  createSupplier,
  getSupplier,
  updateSupplier,
  deleteSupplier,
  supplierSummary,
};
