"use strict";

const { and, desc, eq, ilike, or, sql } = require("drizzle-orm");

const { db } = require("../config/db");
const AUDIT = require("../audit/actions");
const { safeLogAudit } = require("./auditService");
const { suppliers } = require("../db/schema/suppliers.schema");
const { supplierBills } = require("../db/schema/supplier_bills.schema");
const { getSupplierProfileBySupplierId } = require("./supplierProfilesService");
const {
  getSupplierEvaluationBySupplierId,
} = require("./supplierEvaluationsService");

function cleanStr(x) {
  const s = x == null ? "" : String(x).trim();
  return s || null;
}

function toInt(v, dflt = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

function normalizeSourceType(v) {
  const s = String(v || "LOCAL")
    .trim()
    .toUpperCase();
  return s === "ABROAD" ? "ABROAD" : "LOCAL";
}

function normalizeCurrency(v, fallback = "RWF") {
  const s = String(v || fallback)
    .trim()
    .toUpperCase();
  return s === "USD" ? "USD" : "RWF";
}

function normalizeBool(v, def = true) {
  if (v === true || v === false) return v;
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return def;
}

function buildCreatePayload(payload = {}) {
  const name = cleanStr(payload.name);
  if (!name || name.length < 2) {
    const err = new Error("Supplier name must be at least 2 characters");
    err.statusCode = 400;
    throw err;
  }

  const sourceType = normalizeSourceType(payload.sourceType);
  const defaultCurrency = normalizeCurrency(
    payload.defaultCurrency,
    sourceType === "ABROAD" ? "USD" : "RWF",
  );

  return {
    name,
    contactName: cleanStr(payload.contactName),
    phone: cleanStr(payload.phone),
    email: cleanStr(payload.email),
    country: cleanStr(payload.country),
    city: cleanStr(payload.city),
    sourceType,
    defaultCurrency,
    address: cleanStr(payload.address),
    notes: cleanStr(payload.notes),
    isActive: normalizeBool(payload.isActive, true),
  };
}

function buildUpdatePayload(payload = {}) {
  const patch = {};

  if (payload.name !== undefined) {
    const name = cleanStr(payload.name);
    if (!name || name.length < 2) {
      const err = new Error("Supplier name must be at least 2 characters");
      err.statusCode = 400;
      throw err;
    }
    patch.name = name;
  }

  if (payload.contactName !== undefined) {
    patch.contactName = cleanStr(payload.contactName);
  }

  if (payload.phone !== undefined) {
    patch.phone = cleanStr(payload.phone);
  }

  if (payload.email !== undefined) {
    patch.email = cleanStr(payload.email);
  }

  if (payload.country !== undefined) {
    patch.country = cleanStr(payload.country);
  }

  if (payload.city !== undefined) {
    patch.city = cleanStr(payload.city);
  }

  if (payload.sourceType !== undefined) {
    patch.sourceType = normalizeSourceType(payload.sourceType);
  }

  if (payload.defaultCurrency !== undefined) {
    patch.defaultCurrency = normalizeCurrency(payload.defaultCurrency);
  }

  if (payload.address !== undefined) {
    patch.address = cleanStr(payload.address);
  }

  if (payload.notes !== undefined) {
    patch.notes = cleanStr(payload.notes);
  }

  if (payload.isActive !== undefined) {
    patch.isActive = normalizeBool(payload.isActive, true);
  }

  if (Object.keys(patch).length === 0) {
    const err = new Error("Provide at least one field to update");
    err.statusCode = 400;
    throw err;
  }

  return patch;
}

async function getSupplierOrThrow(id, tx = db) {
  const supplierId = toInt(id, null);
  if (!supplierId || supplierId <= 0) {
    const err = new Error("Invalid supplier id");
    err.statusCode = 400;
    throw err;
  }

  const rows = await tx
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

async function createOwnerSupplier({ actorUser, payload }) {
  const data = buildCreatePayload(payload);

  const rows = await db
    .insert(suppliers)
    .values({
      name: data.name,
      contactName: data.contactName,
      phone: data.phone,
      email: data.email,
      country: data.country,
      city: data.city,
      sourceType: data.sourceType,
      defaultCurrency: data.defaultCurrency,
      address: data.address,
      notes: data.notes,
      isActive: data.isActive,
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

  const created = rows?.[0] || null;

  if (created?.id && actorUser?.id) {
    await safeLogAudit({
      locationId: actorUser.locationId || null,
      userId: actorUser.id,
      action: AUDIT.OWNER_SUPPLIER_CREATE,
      entity: "supplier",
      entityId: created.id,
      description: `Created supplier ${created.name}`,
      meta: {
        supplierId: created.id,
        sourceType: created.sourceType,
        defaultCurrency: created.defaultCurrency,
      },
    });
  }

  return created;
}

async function updateOwnerSupplier({ id, actorUser, payload }) {
  await getSupplierOrThrow(id);

  const patch = buildUpdatePayload(payload);

  const rows = await db
    .update(suppliers)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, toInt(id)))
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

  const updated = rows?.[0] || null;

  if (updated?.id && actorUser?.id) {
    await safeLogAudit({
      locationId: actorUser.locationId || null,
      userId: actorUser.id,
      action: AUDIT.OWNER_SUPPLIER_UPDATE,
      entity: "supplier",
      entityId: updated.id,
      description: `Updated supplier ${updated.name}`,
      meta: {
        supplierId: updated.id,
        sourceType: updated.sourceType,
        defaultCurrency: updated.defaultCurrency,
        isActive: updated.isActive,
      },
    });
  }

  return updated;
}

async function deactivateOwnerSupplier({ id, actorUser, reason }) {
  const current = await getSupplierOrThrow(id);
  if (current.isActive === false) return current;

  const nextNotes = cleanStr(reason)
    ? `${cleanStr(current.notes) ? `${cleanStr(current.notes)}\n` : ""}[DEACTIVATED] ${cleanStr(reason)}`
    : current.notes;

  const rows = await db
    .update(suppliers)
    .set({
      isActive: false,
      notes: nextNotes,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, toInt(id)))
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

  const updated = rows?.[0] || null;

  if (updated?.id && actorUser?.id) {
    await safeLogAudit({
      locationId: actorUser.locationId || null,
      userId: actorUser.id,
      action: AUDIT.OWNER_SUPPLIER_DEACTIVATE,
      entity: "supplier",
      entityId: updated.id,
      description: `Deactivated supplier ${updated.name}`,
      meta: {
        supplierId: updated.id,
        reason: cleanStr(reason),
      },
    });
  }

  return updated;
}

async function reactivateOwnerSupplier({ id, actorUser }) {
  const current = await getSupplierOrThrow(id);
  if (current.isActive === true) return current;

  const rows = await db
    .update(suppliers)
    .set({
      isActive: true,
      updatedAt: new Date(),
    })
    .where(eq(suppliers.id, toInt(id)))
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

  const updated = rows?.[0] || null;

  if (updated?.id && actorUser?.id) {
    await safeLogAudit({
      locationId: actorUser.locationId || null,
      userId: actorUser.id,
      action: AUDIT.OWNER_SUPPLIER_REACTIVATE,
      entity: "supplier",
      entityId: updated.id,
      description: `Reactivated supplier ${updated.name}`,
      meta: {
        supplierId: updated.id,
      },
    });
  }

  return updated;
}

async function getOwnerSuppliersSummary(rawFilters = {}) {
  const q = cleanStr(rawFilters.q);
  const sourceType = cleanStr(rawFilters.sourceType)?.toUpperCase() || null;
  const active =
    rawFilters.active === true || rawFilters.active === false
      ? rawFilters.active
      : String(rawFilters.active || "") === "true"
        ? true
        : String(rawFilters.active || "") === "false"
          ? false
          : null;
  const locationId = toInt(rawFilters.locationId, null);

  const supplierWhere = [];

  if (q) {
    supplierWhere.push(
      or(
        ilike(suppliers.name, `%${q}%`),
        ilike(suppliers.contactName, `%${q}%`),
        ilike(suppliers.phone, `%${q}%`),
        ilike(suppliers.email, `%${q}%`),
        ilike(suppliers.country, `%${q}%`),
        ilike(suppliers.city, `%${q}%`),
      ),
    );
  }

  if (sourceType) {
    supplierWhere.push(eq(suppliers.sourceType, sourceType));
  }

  if (active === true) supplierWhere.push(eq(suppliers.isActive, true));
  if (active === false) supplierWhere.push(eq(suppliers.isActive, false));

  const supplierRows = await db
    .select({
      suppliersCount: sql`count(*)::int`.as("suppliersCount"),
      activeSuppliersCount:
        sql`count(*) filter (where ${suppliers.isActive} = true)::int`.as(
          "activeSuppliersCount",
        ),
      localSuppliersCount:
        sql`count(*) filter (where ${suppliers.sourceType} = 'LOCAL')::int`.as(
          "localSuppliersCount",
        ),
      abroadSuppliersCount:
        sql`count(*) filter (where ${suppliers.sourceType} = 'ABROAD')::int`.as(
          "abroadSuppliersCount",
        ),
    })
    .from(suppliers)
    .where(supplierWhere.length ? and(...supplierWhere) : undefined);

  const billsWhere = [sql`${supplierBills.status} <> 'VOID'`];
  if (locationId) {
    billsWhere.push(eq(supplierBills.locationId, locationId));
  }

  const billRows = await db
    .select({
      billsCount: sql`count(*)::int`.as("billsCount"),
      totalBilled: sql`coalesce(sum(${supplierBills.totalAmount}), 0)::int`.as(
        "totalBilled",
      ),
      totalPaid: sql`coalesce(sum(${supplierBills.paidAmount}), 0)::int`.as(
        "totalPaid",
      ),
      totalOutstanding:
        sql`coalesce(sum(greatest(${supplierBills.totalAmount} - ${supplierBills.paidAmount}, 0)), 0)::int`.as(
          "totalOutstanding",
        ),
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
    })
    .from(supplierBills)
    .where(and(...billsWhere));

  return {
    ...(supplierRows?.[0] || {
      suppliersCount: 0,
      activeSuppliersCount: 0,
      localSuppliersCount: 0,
      abroadSuppliersCount: 0,
    }),
    ...(billRows?.[0] || {
      billsCount: 0,
      totalBilled: 0,
      totalPaid: 0,
      totalOutstanding: 0,
      overdueBillsCount: 0,
      overdueAmount: 0,
    }),
  };
}

async function listOwnerSuppliers(rawFilters = {}) {
  const q = cleanStr(rawFilters.q);
  const sourceType = cleanStr(rawFilters.sourceType)?.toUpperCase() || null;
  const active =
    rawFilters.active === true || rawFilters.active === false
      ? rawFilters.active
      : String(rawFilters.active || "") === "true"
        ? true
        : String(rawFilters.active || "") === "false"
          ? false
          : null;
  const locationId = toInt(rawFilters.locationId, null);
  const limit = Math.max(1, Math.min(100, toInt(rawFilters.limit, 50) || 50));
  const offset = Math.max(0, toInt(rawFilters.offset, 0) || 0);

  const where = [];

  if (q) {
    where.push(
      or(
        ilike(suppliers.name, `%${q}%`),
        ilike(suppliers.contactName, `%${q}%`),
        ilike(suppliers.phone, `%${q}%`),
        ilike(suppliers.email, `%${q}%`),
        ilike(suppliers.country, `%${q}%`),
        ilike(suppliers.city, `%${q}%`),
      ),
    );
  }

  if (sourceType) {
    where.push(eq(suppliers.sourceType, sourceType));
  }

  if (active === true) where.push(eq(suppliers.isActive, true));
  if (active === false) where.push(eq(suppliers.isActive, false));

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

      billsCount: sql`coalesce((
        select count(*)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status <> 'VOID'
      ), 0)`.as("billsCount"),

      totalBilled: sql`coalesce((
        select sum(sb.total_amount)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status <> 'VOID'
      ), 0)`.as("totalBilled"),

      totalPaid: sql`coalesce((
        select sum(sb.paid_amount)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status <> 'VOID'
      ), 0)`.as("totalPaid"),

      balanceDue: sql`coalesce((
        select sum(greatest(sb.total_amount - sb.paid_amount, 0))::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status <> 'VOID'
      ), 0)`.as("balanceDue"),

      overdueBillsCount: sql`coalesce((
        select count(*)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status not in ('PAID', 'VOID')
          and sb.due_date is not null
          and sb.due_date < CURRENT_DATE
      ), 0)`.as("overdueBillsCount"),

      overdueAmount: sql`coalesce((
        select sum(greatest(sb.total_amount - sb.paid_amount, 0))::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status not in ('PAID', 'VOID')
          and sb.due_date is not null
          and sb.due_date < CURRENT_DATE
      ), 0)`.as("overdueAmount"),
    })
    .from(suppliers)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(suppliers.id))
    .limit(limit)
    .offset(offset);

  return rows || [];
}

async function getOwnerSupplierById({ id, locationId }) {
  const supplierId = toInt(id, null);
  if (!supplierId || supplierId <= 0) return null;

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

      billsCount: sql`coalesce((
        select count(*)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status <> 'VOID'
      ), 0)`.as("billsCount"),

      totalBilled: sql`coalesce((
        select sum(sb.total_amount)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status <> 'VOID'
      ), 0)`.as("totalBilled"),

      totalPaid: sql`coalesce((
        select sum(sb.paid_amount)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status <> 'VOID'
      ), 0)`.as("totalPaid"),

      balanceDue: sql`coalesce((
        select sum(greatest(sb.total_amount - sb.paid_amount, 0))::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status <> 'VOID'
      ), 0)`.as("balanceDue"),

      openBillsCount: sql`coalesce((
        select count(*)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status = 'OPEN'
      ), 0)`.as("openBillsCount"),

      partiallyPaidCount: sql`coalesce((
        select count(*)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status = 'PARTIALLY_PAID'
      ), 0)`.as("partiallyPaidCount"),

      paidBillsCount: sql`coalesce((
        select count(*)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status = 'PAID'
      ), 0)`.as("paidBillsCount"),

      overdueBillsCount: sql`coalesce((
        select count(*)::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status not in ('PAID', 'VOID')
          and sb.due_date is not null
          and sb.due_date < CURRENT_DATE
      ), 0)`.as("overdueBillsCount"),

      overdueAmount: sql`coalesce((
        select sum(greatest(sb.total_amount - sb.paid_amount, 0))::int
        from supplier_bills sb
        where sb.supplier_id = ${suppliers.id}
          ${locationId ? sql`and sb.location_id = ${locationId}` : sql``}
          and sb.status not in ('PAID', 'VOID')
          and sb.due_date is not null
          and sb.due_date < CURRENT_DATE
      ), 0)`.as("overdueAmount"),
    })
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .limit(1);

  const supplier = rows?.[0] || null;
  if (!supplier) return null;

  const [profile, evaluation] = await Promise.all([
    getSupplierProfileBySupplierId(supplierId).catch(() => null),
    getSupplierEvaluationBySupplierId(supplierId).catch(() => null),
  ]);

  return {
    supplier,
    profile,
    evaluation,
  };
}

module.exports = {
  createOwnerSupplier,
  updateOwnerSupplier,
  deactivateOwnerSupplier,
  reactivateOwnerSupplier,
  getOwnerSuppliersSummary,
  listOwnerSuppliers,
  getOwnerSupplierById,
};
