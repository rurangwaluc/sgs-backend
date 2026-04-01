"use strict";

const { eq } = require("drizzle-orm");
const { db } = require("../config/db");

const { suppliers } = require("../db/schema/suppliers.schema");
const {
  supplierEvaluations,
} = require("../db/schema/supplier_evaluations.schema");

function toInt(v, dflt = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : dflt;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

function normalizeBool(v, dflt = false) {
  if (v === true || v === false) return v;
  if (v == null || v === "") return dflt;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;
  return dflt;
}

function normalizeRating(v, fieldName) {
  const n = toInt(v, null);
  if (n == null || n < 1 || n > 5) {
    const err = new Error(`${fieldName} must be between 1 and 5`);
    err.code = "BAD_RATING";
    throw err;
  }
  return n;
}

function normalizeIssueCount(v) {
  const n = toInt(v, 0);
  if (n < 0) {
    const err = new Error("issueCount cannot be negative");
    err.code = "BAD_ISSUE_COUNT";
    throw err;
  }
  return n;
}

function parseDateOrNull(v, fieldName = "date") {
  if (v == null || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`${fieldName} is invalid`);
    err.code = "BAD_DATE";
    throw err;
  }
  return d;
}

function normalizeRiskLevel(v, dflt = "MEDIUM") {
  const s = String(v || dflt)
    .trim()
    .toUpperCase();

  if (["LOW", "MEDIUM", "HIGH"].includes(s)) return s;

  const err = new Error("riskLevel must be LOW, MEDIUM, or HIGH");
  err.code = "BAD_RISK_LEVEL";
  throw err;
}

function computeOverallScore({
  reliabilityRating,
  priceRating,
  qualityRating,
  speedRating,
  communicationRating,
  issueCount,
}) {
  const ratings = [
    normalizeRating(reliabilityRating, "reliabilityRating"),
    normalizeRating(priceRating, "priceRating"),
    normalizeRating(qualityRating, "qualityRating"),
    normalizeRating(speedRating, "speedRating"),
    normalizeRating(communicationRating, "communicationRating"),
  ];

  const avg = ratings.reduce((sum, n) => sum + n, 0) / ratings.length;
  const penalty = Math.min(1.5, normalizeIssueCount(issueCount) * 0.1);
  const adjusted = Math.max(0, avg - penalty);

  return Math.round(adjusted * 100);
}

function computeRiskLevel({ overallScore, isWatchlist }) {
  if (normalizeBool(isWatchlist, false)) return "HIGH";

  const score = toInt(overallScore, 0) || 0;

  if (score >= 420) return "LOW";
  if (score >= 300) return "MEDIUM";
  return "HIGH";
}

function mapSupplierEvaluation(row) {
  if (!row) return null;

  return {
    id: row.id,
    supplierId: row.supplierId,

    reliabilityRating: Number(row.reliabilityRating || 0),
    priceRating: Number(row.priceRating || 0),
    qualityRating: Number(row.qualityRating || 0),
    speedRating: Number(row.speedRating || 0),
    communicationRating: Number(row.communicationRating || 0),

    issueCount: Number(row.issueCount || 0),
    lastIssueAt: row.lastIssueAt || null,

    isPreferred: !!row.isPreferred,
    isWatchlist: !!row.isWatchlist,

    overallScore: Number(row.overallScore || 0),
    riskLevel: row.riskLevel || "MEDIUM",

    ownerAssessmentNote: row.ownerAssessmentNote || null,

    evaluatedByUserId: row.evaluatedByUserId || null,
    evaluatedAt: row.evaluatedAt || null,

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

async function getSupplierEvaluationBySupplierId(supplierId, tx = db) {
  const id = toInt(supplierId, null);

  if (!id || id <= 0) {
    const err = new Error("Invalid supplier id");
    err.code = "BAD_SUPPLIER_ID";
    throw err;
  }

  const rows = await tx
    .select({
      id: supplierEvaluations.id,
      supplierId: supplierEvaluations.supplierId,

      reliabilityRating: supplierEvaluations.reliabilityRating,
      priceRating: supplierEvaluations.priceRating,
      qualityRating: supplierEvaluations.qualityRating,
      speedRating: supplierEvaluations.speedRating,
      communicationRating: supplierEvaluations.communicationRating,

      issueCount: supplierEvaluations.issueCount,
      lastIssueAt: supplierEvaluations.lastIssueAt,

      isPreferred: supplierEvaluations.isPreferred,
      isWatchlist: supplierEvaluations.isWatchlist,

      overallScore: supplierEvaluations.overallScore,
      riskLevel: supplierEvaluations.riskLevel,

      ownerAssessmentNote: supplierEvaluations.ownerAssessmentNote,

      evaluatedByUserId: supplierEvaluations.evaluatedByUserId,
      evaluatedAt: supplierEvaluations.evaluatedAt,

      createdAt: supplierEvaluations.createdAt,
      updatedAt: supplierEvaluations.updatedAt,
    })
    .from(supplierEvaluations)
    .where(eq(supplierEvaluations.supplierId, id))
    .limit(1);

  return mapSupplierEvaluation(rows?.[0] || null);
}

function buildEvaluationPayload(payload = {}, existing = null) {
  const reliabilityRating = normalizeRating(
    payload.reliabilityRating ?? existing?.reliabilityRating,
    "reliabilityRating",
  );
  const priceRating = normalizeRating(
    payload.priceRating ?? existing?.priceRating,
    "priceRating",
  );
  const qualityRating = normalizeRating(
    payload.qualityRating ?? existing?.qualityRating,
    "qualityRating",
  );
  const speedRating = normalizeRating(
    payload.speedRating ?? existing?.speedRating,
    "speedRating",
  );
  const communicationRating = normalizeRating(
    payload.communicationRating ?? existing?.communicationRating,
    "communicationRating",
  );

  const issueCount = normalizeIssueCount(
    payload.issueCount ?? existing?.issueCount ?? 0,
  );
  const isPreferred = normalizeBool(
    payload.isPreferred ?? existing?.isPreferred ?? false,
    false,
  );
  const isWatchlist = normalizeBool(
    payload.isWatchlist ?? existing?.isWatchlist ?? false,
    false,
  );

  const overallScore =
    payload.overallScore != null
      ? Math.max(0, toInt(payload.overallScore, 0) || 0)
      : computeOverallScore({
          reliabilityRating,
          priceRating,
          qualityRating,
          speedRating,
          communicationRating,
          issueCount,
        });

  const riskLevel =
    payload.riskLevel != null
      ? normalizeRiskLevel(payload.riskLevel)
      : computeRiskLevel({ overallScore, isWatchlist });

  return {
    reliabilityRating,
    priceRating,
    qualityRating,
    speedRating,
    communicationRating,

    issueCount,
    lastIssueAt:
      payload.lastIssueAt !== undefined
        ? parseDateOrNull(payload.lastIssueAt, "lastIssueAt")
        : existing?.lastIssueAt || null,

    isPreferred,
    isWatchlist,

    overallScore,
    riskLevel,

    ownerAssessmentNote:
      payload.ownerAssessmentNote !== undefined
        ? cleanStr(payload.ownerAssessmentNote)
        : cleanStr(existing?.ownerAssessmentNote),

    evaluatedByUserId:
      payload.evaluatedByUserId !== undefined
        ? toInt(payload.evaluatedByUserId, null)
        : existing?.evaluatedByUserId || null,

    evaluatedAt:
      payload.evaluatedAt !== undefined
        ? parseDateOrNull(payload.evaluatedAt, "evaluatedAt")
        : existing?.evaluatedAt || null,
  };
}

async function createSupplierEvaluation(payload, tx = db) {
  const supplierId = toInt(payload?.supplierId, null);

  await getSupplierOrThrow(supplierId, tx);

  const existing = await getSupplierEvaluationBySupplierId(supplierId, tx);
  if (existing) {
    const err = new Error("Supplier evaluation already exists");
    err.code = "SUPPLIER_EVALUATION_EXISTS";
    throw err;
  }

  const data = buildEvaluationPayload(payload, null);
  const now = new Date();

  const rows = await tx
    .insert(supplierEvaluations)
    .values({
      supplierId,

      reliabilityRating: data.reliabilityRating,
      priceRating: data.priceRating,
      qualityRating: data.qualityRating,
      speedRating: data.speedRating,
      communicationRating: data.communicationRating,

      issueCount: data.issueCount,
      lastIssueAt: data.lastIssueAt,

      isPreferred: data.isPreferred,
      isWatchlist: data.isWatchlist,

      overallScore: data.overallScore,
      riskLevel: data.riskLevel,

      ownerAssessmentNote: data.ownerAssessmentNote,

      evaluatedByUserId: data.evaluatedByUserId,
      evaluatedAt: data.evaluatedAt || now,

      createdAt: now,
      updatedAt: now,
    })
    .returning({
      id: supplierEvaluations.id,
      supplierId: supplierEvaluations.supplierId,

      reliabilityRating: supplierEvaluations.reliabilityRating,
      priceRating: supplierEvaluations.priceRating,
      qualityRating: supplierEvaluations.qualityRating,
      speedRating: supplierEvaluations.speedRating,
      communicationRating: supplierEvaluations.communicationRating,

      issueCount: supplierEvaluations.issueCount,
      lastIssueAt: supplierEvaluations.lastIssueAt,

      isPreferred: supplierEvaluations.isPreferred,
      isWatchlist: supplierEvaluations.isWatchlist,

      overallScore: supplierEvaluations.overallScore,
      riskLevel: supplierEvaluations.riskLevel,

      ownerAssessmentNote: supplierEvaluations.ownerAssessmentNote,

      evaluatedByUserId: supplierEvaluations.evaluatedByUserId,
      evaluatedAt: supplierEvaluations.evaluatedAt,

      createdAt: supplierEvaluations.createdAt,
      updatedAt: supplierEvaluations.updatedAt,
    });

  return mapSupplierEvaluation(rows?.[0] || null);
}

async function updateSupplierEvaluation({ supplierId, payload }, tx = db) {
  const id = toInt(supplierId, null);

  await getSupplierOrThrow(id, tx);

  const existing = await getSupplierEvaluationBySupplierId(id, tx);
  if (!existing) {
    const err = new Error("Supplier evaluation not found");
    err.code = "SUPPLIER_EVALUATION_NOT_FOUND";
    throw err;
  }

  const data = buildEvaluationPayload(payload, existing);

  const rows = await tx
    .update(supplierEvaluations)
    .set({
      reliabilityRating: data.reliabilityRating,
      priceRating: data.priceRating,
      qualityRating: data.qualityRating,
      speedRating: data.speedRating,
      communicationRating: data.communicationRating,

      issueCount: data.issueCount,
      lastIssueAt: data.lastIssueAt,

      isPreferred: data.isPreferred,
      isWatchlist: data.isWatchlist,

      overallScore: data.overallScore,
      riskLevel: data.riskLevel,

      ownerAssessmentNote: data.ownerAssessmentNote,

      evaluatedByUserId: data.evaluatedByUserId,
      evaluatedAt: data.evaluatedAt || new Date(),

      updatedAt: new Date(),
    })
    .where(eq(supplierEvaluations.supplierId, id))
    .returning({
      id: supplierEvaluations.id,
      supplierId: supplierEvaluations.supplierId,

      reliabilityRating: supplierEvaluations.reliabilityRating,
      priceRating: supplierEvaluations.priceRating,
      qualityRating: supplierEvaluations.qualityRating,
      speedRating: supplierEvaluations.speedRating,
      communicationRating: supplierEvaluations.communicationRating,

      issueCount: supplierEvaluations.issueCount,
      lastIssueAt: supplierEvaluations.lastIssueAt,

      isPreferred: supplierEvaluations.isPreferred,
      isWatchlist: supplierEvaluations.isWatchlist,

      overallScore: supplierEvaluations.overallScore,
      riskLevel: supplierEvaluations.riskLevel,

      ownerAssessmentNote: supplierEvaluations.ownerAssessmentNote,

      evaluatedByUserId: supplierEvaluations.evaluatedByUserId,
      evaluatedAt: supplierEvaluations.evaluatedAt,

      createdAt: supplierEvaluations.createdAt,
      updatedAt: supplierEvaluations.updatedAt,
    });

  return mapSupplierEvaluation(rows?.[0] || null);
}

async function upsertSupplierEvaluation(payload, tx = db) {
  const supplierId = toInt(payload?.supplierId, null);

  await getSupplierOrThrow(supplierId, tx);

  const existing = await getSupplierEvaluationBySupplierId(supplierId, tx);

  if (existing) {
    return updateSupplierEvaluation({ supplierId, payload }, tx);
  }

  return createSupplierEvaluation(payload, tx);
}

module.exports = {
  getSupplierEvaluationBySupplierId,
  createSupplierEvaluation,
  updateSupplierEvaluation,
  upsertSupplierEvaluation,
  computeOverallScore,
  computeRiskLevel,
};
