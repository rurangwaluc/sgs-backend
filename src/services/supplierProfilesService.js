"use strict";

const { and, eq } = require("drizzle-orm");
const { db } = require("../config/db");

const { suppliers } = require("../db/schema/suppliers.schema");
const { supplierProfiles } = require("../db/schema/supplier_profiles.schema");

const { PAYMENT_METHODS } = require("../validators/supplierProfiles.schema");

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

function toInt(v, dflt = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

function normalizePaymentMethod(v, fallback = "BANK") {
  const s = String(v || fallback)
    .trim()
    .toUpperCase();

  return PAYMENT_METHODS.includes(s) ? s : fallback;
}

function normalizeAcceptedPaymentMethods(
  value,
  preferredPaymentMethod = "BANK",
) {
  const preferred = normalizePaymentMethod(preferredPaymentMethod, "BANK");

  let arr = [];

  if (Array.isArray(value)) {
    arr = value;
  } else if (typeof value === "string") {
    arr = value.split(",");
  }

  const normalized = [
    ...new Set(arr.map((x) => normalizePaymentMethod(x, "")).filter(Boolean)),
  ];

  if (!normalized.includes(preferred)) {
    normalized.unshift(preferred);
  }

  return normalized;
}

function normalizePaymentTermsLabel(v, fallback = "IMMEDIATE") {
  const allowed = ["IMMEDIATE", "7_DAYS", "15_DAYS", "30_DAYS", "CUSTOM"];
  const s = String(v || fallback)
    .trim()
    .toUpperCase();

  return allowed.includes(s) ? s : fallback;
}

function normalizePaymentTermsDays(label, days) {
  const cleanLabel = normalizePaymentTermsLabel(label, "IMMEDIATE");
  const cleanDays = toInt(days, null);

  if (cleanLabel === "IMMEDIATE") return 0;
  if (cleanLabel === "7_DAYS") return 7;
  if (cleanLabel === "15_DAYS") return 15;
  if (cleanLabel === "30_DAYS") return 30;

  return cleanDays != null && cleanDays > 0 ? cleanDays : 0;
}

function serializeAcceptedPaymentMethods(arr) {
  const normalized = Array.isArray(arr) ? arr : [];
  return normalized.length ? normalized.join(",") : null;
}

function mapSupplierProfile(row) {
  if (!row) return null;

  return {
    id: row.id,
    supplierId: row.supplierId,
    preferredPaymentMethod: row.preferredPaymentMethod,
    acceptedPaymentMethods: row.acceptedPaymentMethods
      ? String(row.acceptedPaymentMethods)
          .split(",")
          .map((x) => String(x).trim())
          .filter(Boolean)
      : [],
    paymentTermsLabel: row.paymentTermsLabel,
    paymentTermsDays: Number(row.paymentTermsDays || 0),
    creditLimit: Number(row.creditLimit || 0),

    bankName: row.bankName || null,
    bankAccountName: row.bankAccountName || null,
    bankAccountNumber: row.bankAccountNumber || null,
    bankBranch: row.bankBranch || null,

    momoName: row.momoName || null,
    momoPhone: row.momoPhone || null,

    taxId: row.taxId || null,
    paymentInstructions: row.paymentInstructions || null,

    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function getSupplierOrThrow(supplierId, tx = db) {
  const id = toInt(supplierId, null);

  if (!id || id <= 0) {
    const err = new Error("Invalid supplier id");
    err.code = "BAD_SUPPLIER_ID";
    throw err;
  }

  const rows = await tx
    .select({
      id: suppliers.id,
      name: suppliers.name,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);

  const supplier = rows?.[0] || null;

  if (!supplier) {
    const err = new Error("Supplier not found");
    err.code = "SUPPLIER_NOT_FOUND";
    throw err;
  }

  return supplier;
}

function buildProfileInsertOrUpdatePayload(payload = {}, existing = null) {
  const preferredPaymentMethod = normalizePaymentMethod(
    payload.preferredPaymentMethod ??
      existing?.preferredPaymentMethod ??
      "BANK",
    "BANK",
  );

  const acceptedPaymentMethods = normalizeAcceptedPaymentMethods(
    payload.acceptedPaymentMethods ?? existing?.acceptedPaymentMethods ?? [],
    preferredPaymentMethod,
  );

  const paymentTermsLabel = normalizePaymentTermsLabel(
    payload.paymentTermsLabel ?? existing?.paymentTermsLabel ?? "IMMEDIATE",
    "IMMEDIATE",
  );

  const paymentTermsDays = normalizePaymentTermsDays(
    paymentTermsLabel,
    payload.paymentTermsDays ?? existing?.paymentTermsDays ?? null,
  );

  return {
    preferredPaymentMethod,
    acceptedPaymentMethods: serializeAcceptedPaymentMethods(
      acceptedPaymentMethods,
    ),
    paymentTermsLabel,
    paymentTermsDays,
    creditLimit: Math.max(
      0,
      toInt(payload.creditLimit ?? existing?.creditLimit ?? 0, 0) || 0,
    ),

    bankName: cleanStr(payload.bankName ?? existing?.bankName),
    bankAccountName: cleanStr(
      payload.bankAccountName ?? existing?.bankAccountName,
    ),
    bankAccountNumber: cleanStr(
      payload.bankAccountNumber ?? existing?.bankAccountNumber,
    ),
    bankBranch: cleanStr(payload.bankBranch ?? existing?.bankBranch),

    momoName: cleanStr(payload.momoName ?? existing?.momoName),
    momoPhone: cleanStr(payload.momoPhone ?? existing?.momoPhone),

    taxId: cleanStr(payload.taxId ?? existing?.taxId),
    paymentInstructions: cleanStr(
      payload.paymentInstructions ?? existing?.paymentInstructions,
    ),
  };
}

function assertProfileBusinessRules(profile) {
  if (!profile) {
    const err = new Error("Supplier profile payload is required");
    err.code = "BAD_PROFILE_PAYLOAD";
    throw err;
  }

  const preferred = normalizePaymentMethod(
    profile.preferredPaymentMethod,
    "BANK",
  );

  const accepted = normalizeAcceptedPaymentMethods(
    profile.acceptedPaymentMethods,
    preferred,
  );

  if (!accepted.includes(preferred)) {
    const err = new Error(
      "acceptedPaymentMethods must include preferredPaymentMethod",
    );
    err.code = "BAD_ACCEPTED_PAYMENT_METHODS";
    throw err;
  }

  if (preferred === "BANK") {
    if (!cleanStr(profile.bankName)) {
      const err = new Error(
        "bankName is required when preferredPaymentMethod is BANK",
      );
      err.code = "BAD_BANK_NAME";
      throw err;
    }
    if (!cleanStr(profile.bankAccountName)) {
      const err = new Error(
        "bankAccountName is required when preferredPaymentMethod is BANK",
      );
      err.code = "BAD_BANK_ACCOUNT_NAME";
      throw err;
    }
    if (!cleanStr(profile.bankAccountNumber)) {
      const err = new Error(
        "bankAccountNumber is required when preferredPaymentMethod is BANK",
      );
      err.code = "BAD_BANK_ACCOUNT_NUMBER";
      throw err;
    }
  }

  if (preferred === "MOMO") {
    if (!cleanStr(profile.momoName)) {
      const err = new Error(
        "momoName is required when preferredPaymentMethod is MOMO",
      );
      err.code = "BAD_MOMO_NAME";
      throw err;
    }
    if (!cleanStr(profile.momoPhone)) {
      const err = new Error(
        "momoPhone is required when preferredPaymentMethod is MOMO",
      );
      err.code = "BAD_MOMO_PHONE";
      throw err;
    }
  }

  const termsLabel = normalizePaymentTermsLabel(
    profile.paymentTermsLabel,
    "IMMEDIATE",
  );
  const termsDays = toInt(profile.paymentTermsDays, 0) || 0;

  if (termsLabel === "IMMEDIATE" && termsDays !== 0) {
    const err = new Error(
      "paymentTermsDays must be 0 when paymentTermsLabel is IMMEDIATE",
    );
    err.code = "BAD_PAYMENT_TERMS";
    throw err;
  }

  if (termsLabel === "7_DAYS" && termsDays !== 7) {
    const err = new Error(
      "paymentTermsDays must be 7 when paymentTermsLabel is 7_DAYS",
    );
    err.code = "BAD_PAYMENT_TERMS";
    throw err;
  }

  if (termsLabel === "15_DAYS" && termsDays !== 15) {
    const err = new Error(
      "paymentTermsDays must be 15 when paymentTermsLabel is 15_DAYS",
    );
    err.code = "BAD_PAYMENT_TERMS";
    throw err;
  }

  if (termsLabel === "30_DAYS" && termsDays !== 30) {
    const err = new Error(
      "paymentTermsDays must be 30 when paymentTermsLabel is 30_DAYS",
    );
    err.code = "BAD_PAYMENT_TERMS";
    throw err;
  }

  if (termsLabel === "CUSTOM" && termsDays <= 0) {
    const err = new Error(
      "paymentTermsDays must be greater than 0 when paymentTermsLabel is CUSTOM",
    );
    err.code = "BAD_PAYMENT_TERMS";
    throw err;
  }
}

async function getSupplierProfileBySupplierId(supplierId, tx = db) {
  const id = toInt(supplierId, null);

  if (!id || id <= 0) {
    const err = new Error("Invalid supplier id");
    err.code = "BAD_SUPPLIER_ID";
    throw err;
  }

  const rows = await tx
    .select({
      id: supplierProfiles.id,
      supplierId: supplierProfiles.supplierId,
      preferredPaymentMethod: supplierProfiles.preferredPaymentMethod,
      acceptedPaymentMethods: supplierProfiles.acceptedPaymentMethods,
      paymentTermsLabel: supplierProfiles.paymentTermsLabel,
      paymentTermsDays: supplierProfiles.paymentTermsDays,
      creditLimit: supplierProfiles.creditLimit,

      bankName: supplierProfiles.bankName,
      bankAccountName: supplierProfiles.bankAccountName,
      bankAccountNumber: supplierProfiles.bankAccountNumber,
      bankBranch: supplierProfiles.bankBranch,

      momoName: supplierProfiles.momoName,
      momoPhone: supplierProfiles.momoPhone,

      taxId: supplierProfiles.taxId,
      paymentInstructions: supplierProfiles.paymentInstructions,

      createdAt: supplierProfiles.createdAt,
      updatedAt: supplierProfiles.updatedAt,
    })
    .from(supplierProfiles)
    .where(eq(supplierProfiles.supplierId, id))
    .limit(1);

  return mapSupplierProfile(rows?.[0] || null);
}

async function createSupplierProfile(payload, tx = db) {
  const supplierId = toInt(payload?.supplierId, null);

  await getSupplierOrThrow(supplierId, tx);

  const existing = await getSupplierProfileBySupplierId(supplierId, tx);
  if (existing) {
    const err = new Error("Supplier profile already exists");
    err.code = "SUPPLIER_PROFILE_EXISTS";
    throw err;
  }

  const data = buildProfileInsertOrUpdatePayload(payload, null);
  assertProfileBusinessRules(data);

  const now = new Date();

  const rows = await tx
    .insert(supplierProfiles)
    .values({
      supplierId,
      preferredPaymentMethod: data.preferredPaymentMethod,
      acceptedPaymentMethods: data.acceptedPaymentMethods,
      paymentTermsLabel: data.paymentTermsLabel,
      paymentTermsDays: data.paymentTermsDays,
      creditLimit: data.creditLimit,

      bankName: data.bankName,
      bankAccountName: data.bankAccountName,
      bankAccountNumber: data.bankAccountNumber,
      bankBranch: data.bankBranch,

      momoName: data.momoName,
      momoPhone: data.momoPhone,

      taxId: data.taxId,
      paymentInstructions: data.paymentInstructions,

      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: supplierProfiles.id,
      supplierId: supplierProfiles.supplierId,
      preferredPaymentMethod: supplierProfiles.preferredPaymentMethod,
      acceptedPaymentMethods: supplierProfiles.acceptedPaymentMethods,
      paymentTermsLabel: supplierProfiles.paymentTermsLabel,
      paymentTermsDays: supplierProfiles.paymentTermsDays,
      creditLimit: supplierProfiles.creditLimit,

      bankName: supplierProfiles.bankName,
      bankAccountName: supplierProfiles.bankAccountName,
      bankAccountNumber: supplierProfiles.bankAccountNumber,
      bankBranch: supplierProfiles.bankBranch,

      momoName: supplierProfiles.momoName,
      momoPhone: supplierProfiles.momoPhone,

      taxId: supplierProfiles.taxId,
      paymentInstructions: supplierProfiles.paymentInstructions,

      createdAt: supplierProfiles.createdAt,
      updatedAt: supplierProfiles.updatedAt,
    });

  return mapSupplierProfile(rows?.[0] || null);
}

async function updateSupplierProfile({ supplierId, payload }, tx = db) {
  const id = toInt(supplierId, null);

  await getSupplierOrThrow(id, tx);

  const existing = await getSupplierProfileBySupplierId(id, tx);
  if (!existing) {
    const err = new Error("Supplier profile not found");
    err.code = "SUPPLIER_PROFILE_NOT_FOUND";
    throw err;
  }

  const data = buildProfileInsertOrUpdatePayload(payload, existing);
  assertProfileBusinessRules(data);

  const rows = await tx
    .update(supplierProfiles)
    .set({
      preferredPaymentMethod: data.preferredPaymentMethod,
      acceptedPaymentMethods: data.acceptedPaymentMethods,
      paymentTermsLabel: data.paymentTermsLabel,
      paymentTermsDays: data.paymentTermsDays,
      creditLimit: data.creditLimit,

      bankName: data.bankName,
      bankAccountName: data.bankAccountName,
      bankAccountNumber: data.bankAccountNumber,
      bankBranch: data.bankBranch,

      momoName: data.momoName,
      momoPhone: data.momoPhone,

      taxId: data.taxId,
      paymentInstructions: data.paymentInstructions,

      updatedAt: new Date(),
    })
    .where(eq(supplierProfiles.supplierId, id))
    .returning({
      id: supplierProfiles.id,
      supplierId: supplierProfiles.supplierId,
      preferredPaymentMethod: supplierProfiles.preferredPaymentMethod,
      acceptedPaymentMethods: supplierProfiles.acceptedPaymentMethods,
      paymentTermsLabel: supplierProfiles.paymentTermsLabel,
      paymentTermsDays: supplierProfiles.paymentTermsDays,
      creditLimit: supplierProfiles.creditLimit,

      bankName: supplierProfiles.bankName,
      bankAccountName: supplierProfiles.bankAccountName,
      bankAccountNumber: supplierProfiles.bankAccountNumber,
      bankBranch: supplierProfiles.bankBranch,

      momoName: supplierProfiles.momoName,
      momoPhone: supplierProfiles.momoPhone,

      taxId: supplierProfiles.taxId,
      paymentInstructions: supplierProfiles.paymentInstructions,

      createdAt: supplierProfiles.createdAt,
      updatedAt: supplierProfiles.updatedAt,
    });

  return mapSupplierProfile(rows?.[0] || null);
}

async function upsertSupplierProfile(payload, tx = db) {
  const supplierId = toInt(payload?.supplierId, null);

  await getSupplierOrThrow(supplierId, tx);

  const existing = await getSupplierProfileBySupplierId(supplierId, tx);

  if (existing) {
    return updateSupplierProfile({ supplierId, payload }, tx);
  }

  return createSupplierProfile(payload, tx);
}

module.exports = {
  getSupplierProfileBySupplierId,
  createSupplierProfile,
  updateSupplierProfile,
  upsertSupplierProfile,
};
