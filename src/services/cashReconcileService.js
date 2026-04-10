const { db } = require("../config/db");
const {
  cashReconciliations,
} = require("../db/schema/cash_reconciliations.schema");
const { cashSessions } = require("../db/schema/cash_sessions.schema");
const { auditLogs } = require("../db/schema/audit_logs.schema");
const { and, eq, desc } = require("drizzle-orm");

function toMoneyNumber(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);

  if (typeof v === "string") {
    const cleaned = v.trim().replace(/[^\d-]/g, "");
    if (!cleaned) return NaN;
    return Number(cleaned);
  }
  return NaN;
}

function toInt(v) {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "string") v = v.trim();
  return Number(v);
}

function makeErr(code, message, debug) {
  const err = new Error(message);
  err.code = code;
  if (debug) err.debug = debug;
  return err;
}

function getOfficialClosedCash(session) {
  const countedClosingBalance = Number(
    session?.countedClosingBalance ?? session?.counted_closing_balance,
  );
  if (Number.isFinite(countedClosingBalance)) return countedClosingBalance;

  const closingBalance = Number(
    session?.closingBalance ?? session?.closing_balance,
  );
  if (Number.isFinite(closingBalance)) return closingBalance;

  return 0;
}

/**
 * Reconcile = later verification of the official closed day result
 * - One reconcile per session
 * - Session must be CLOSED
 * - expectedCash = official close cash saved on cash_sessions
 * - difference = countedCash - expectedCash
 */
async function createReconcile({
  locationId,
  cashierId,
  cashSessionId,
  countedCash,
  note,
}) {
  const locId = toInt(locationId);
  const cashId = toInt(cashierId);
  const sessId = toInt(cashSessionId);

  if (!Number.isInteger(locId) || locId <= 0) {
    throw makeErr("BAD_LOCATION", "Invalid locationId");
  }
  if (!Number.isInteger(cashId) || cashId <= 0) {
    throw makeErr("BAD_CASHIER", "Invalid cashierId");
  }
  if (!Number.isInteger(sessId) || sessId <= 0) {
    throw makeErr("BAD_SESSION", "Invalid cashSessionId");
  }

  const cnt = toMoneyNumber(countedCash);
  if (!Number.isFinite(cnt) || cnt < 0) {
    throw makeErr("BAD_AMOUNT", "Invalid countedCash");
  }

  const cleanNote =
    typeof note === "string" && note.trim() ? note.trim().slice(0, 200) : null;

  return db.transaction(async (tx) => {
    // 1) session exists + belongs to location
    const sessRows = await tx
      .select()
      .from(cashSessions)
      .where(
        and(eq(cashSessions.id, sessId), eq(cashSessions.locationId, locId)),
      )
      .limit(1);

    const sess = sessRows[0];
    if (!sess) {
      throw makeErr("SESSION_NOT_FOUND", "Cash session not found");
    }

    if (Number(sess.cashierId) !== cashId) {
      throw makeErr("NOT_YOUR_SESSION", "This cash session is not yours");
    }

    const st = String(sess.status || "").toUpperCase();
    if (st !== "CLOSED") {
      throw makeErr(
        "SESSION_NOT_CLOSED",
        "Cash session must be CLOSED before reconciliation",
        {
          status: sess.status,
          cashSessionId: sessId,
        },
      );
    }

    // 2) strict: block second reconcile attempt
    const existingRows = await tx
      .select({ id: cashReconciliations.id })
      .from(cashReconciliations)
      .where(eq(cashReconciliations.cashSessionId, sessId))
      .limit(1);

    if (existingRows.length > 0) {
      throw makeErr("ALREADY_RECONCILED", "Cash session already reconciled");
    }

    // 3) official close source of truth
    const officialClosedCash = getOfficialClosedCash(sess);
    const difference = cnt - officialClosedCash;

    // 4) insert explicit expectedCash + difference
    const inserted = await tx
      .insert(cashReconciliations)
      .values({
        locationId: locId,
        cashSessionId: sessId,
        cashierId: cashId,
        expectedCash: officialClosedCash,
        countedCash: cnt,
        difference,
        note: cleanNote,
      })
      .returning();

    const created = inserted[0];

    await tx.insert(auditLogs).values({
      locationId: locId,
      userId: cashId,
      action: "CASH_RECONCILE_CREATE",
      entity: "cash_reconciliation",
      entityId: created.id,
      description:
        `Cash check for session #${sessId}. ` +
        `officialClosedCash=${officialClosedCash}, countedAgain=${cnt}, difference=${difference}`,
      meta: {
        cashSessionId: sessId,
        officialClosedCash,
        countedCash: cnt,
        difference,
      },
    });

    return {
      id: Number(created.id),
      locationId: Number(created.locationId),
      cashSessionId: Number(created.cashSessionId),
      cashierId: Number(created.cashierId),
      expectedCash: Number(created.expectedCash),
      countedCash: Number(created.countedCash),
      difference: Number(created.difference),
      note: created.note ?? null,
      createdAt: created.createdAt,
    };
  });
}

async function listReconciles({ locationId, limit = 50 }) {
  const locId = toInt(locationId);
  if (!Number.isInteger(locId) || locId <= 0) {
    throw makeErr("BAD_LOCATION", "Invalid locationId");
  }

  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const rows = await db
    .select()
    .from(cashReconciliations)
    .where(eq(cashReconciliations.locationId, locId))
    .orderBy(desc(cashReconciliations.createdAt))
    .limit(lim);

  return (rows || []).map((r) => ({
    id: Number(r.id),
    locationId: Number(r.locationId),
    cashSessionId: Number(r.cashSessionId),
    cashierId: Number(r.cashierId),
    expectedCash: Number(r.expectedCash),
    countedCash: Number(r.countedCash),
    difference: Number(r.difference),
    note: r.note ?? null,
    createdAt: r.createdAt,
  }));
}

module.exports = { createReconcile, listReconciles };
