const { db } = require("../config/db");
const { cashSessions } = require("../db/schema/cash_sessions.schema");
const { cashLedger } = require("../db/schema/cash_ledger.schema");
const { auditLogs } = require("../db/schema/audit_logs.schema");
const notificationService = require("./notificationService");
const { and, eq, desc } = require("drizzle-orm");

function makeErr(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function toInt(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normSessionRow(s) {
  if (!s) return null;
  return {
    id: Number(s.id),
    locationId: Number(s.locationId),
    cashierId: Number(s.cashierId),
    status: String(s.status),
    openedAt: s.openedAt,
    closedAt: s.closedAt ?? null,
    openingBalance: Number(s.openingBalance ?? 0),
    closingBalance: Number(s.closingBalance ?? 0),

    expectedOpeningBalance: Number(s.expectedOpeningBalance ?? 0),
    openingVarianceAmount: Number(s.openingVarianceAmount ?? 0),
    openingVarianceType: String(s.openingVarianceType || "MATCH"),
    openingVarianceReason: s.openingVarianceReason ?? null,
    previousSessionId:
      s.previousSessionId == null ? null : Number(s.previousSessionId),

    expectedClosingBalance: Number(s.expectedClosingBalance ?? 0),
    countedClosingBalance: Number(s.countedClosingBalance ?? 0),
    closingVarianceAmount: Number(s.closingVarianceAmount ?? 0),
    closingVarianceType: String(s.closingVarianceType || "MATCH"),
    closingVarianceReason: s.closingVarianceReason ?? null,
    closingNote: s.closingNote ?? null,

    updatedAt: s.updatedAt,
  };
}

function getVarianceType(amount) {
  const n = Number(amount || 0);
  if (n === 0) return "MATCH";
  if (n < 0) return "SHORTAGE";
  return "SURPLUS";
}

async function findLastClosedSession(tx, { locationId }) {
  const rows = await tx
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.locationId, locationId),
        eq(cashSessions.status, "CLOSED"),
      ),
    )
    .orderBy(desc(cashSessions.id))
    .limit(1);

  return rows[0] || null;
}

async function computeExpectedCash(tx, { sessionId, openingBalance }) {
  const rows = await tx
    .select({
      direction: cashLedger.direction,
      method: cashLedger.method,
      amount: cashLedger.amount,
    })
    .from(cashLedger)
    .where(eq(cashLedger.cashSessionId, sessionId));

  let totalCashIn = 0;
  let totalCashOut = 0;

  for (const row of rows || []) {
    const method = String(row?.method || "")
      .trim()
      .toUpperCase();
    const direction = String(row?.direction || "")
      .trim()
      .toUpperCase();
    const amount = Number(row?.amount || 0) || 0;

    if (method !== "CASH") continue;

    if (direction === "IN") totalCashIn += amount;
    if (direction === "OUT") totalCashOut += amount;
  }

  return Number(openingBalance || 0) + totalCashIn - totalCashOut;
}

async function openSession({
  locationId,
  cashierId,
  openingBalance,
  openingVarianceReason,
}) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.locationId, locationId),
          eq(cashSessions.cashierId, cashierId),
          eq(cashSessions.status, "OPEN"),
        ),
      )
      .limit(1);

    if (existing.length) {
      throw makeErr(
        "SESSION_ALREADY_OPEN",
        "You already have an OPEN cash session",
      );
    }

    const lastClosed = await findLastClosedSession(tx, { locationId });
    const expectedOpeningBalance = Number(lastClosed?.closingBalance ?? 0) || 0;
    const actualOpeningBalance = Number(openingBalance ?? 0) || 0;
    const openingVarianceAmount = actualOpeningBalance - expectedOpeningBalance;
    const openingVarianceType = getVarianceType(openingVarianceAmount);

    const cleanReason =
      typeof openingVarianceReason === "string" && openingVarianceReason.trim()
        ? openingVarianceReason.trim().slice(0, 300)
        : null;

    if (openingVarianceType !== "MATCH" && !cleanReason) {
      throw makeErr(
        "OPENING_VARIANCE_REASON_REQUIRED",
        "Explain why the opening cash is different from the last confirmed closing cash",
      );
    }

    const [created] = await tx
      .insert(cashSessions)
      .values({
        locationId,
        cashierId,
        status: "OPEN",
        openingBalance: actualOpeningBalance,
        expectedOpeningBalance,
        openingVarianceAmount,
        openingVarianceType,
        openingVarianceReason: cleanReason,
        previousSessionId: lastClosed?.id ?? null,
        openedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    await tx.insert(auditLogs).values({
      locationId,
      userId: cashierId,
      action: "CASH_SESSION_OPEN",
      entity: "cash_session",
      entityId: created.id,
      description:
        `Cash session opened. openingBalance=${actualOpeningBalance}, ` +
        `expectedOpeningBalance=${expectedOpeningBalance}, ` +
        `openingVarianceAmount=${openingVarianceAmount}, ` +
        `openingVarianceType=${openingVarianceType}, ` +
        `reason=${cleanReason || "-"}`,
      meta: {
        openingBalance: actualOpeningBalance,
        expectedOpeningBalance,
        openingVarianceAmount,
        openingVarianceType,
        openingVarianceReason: cleanReason,
        previousSessionId: lastClosed?.id ?? null,
      },
    });

    if (openingVarianceType !== "MATCH") {
      const diffAbs = Math.abs(openingVarianceAmount);
      const varianceWord =
        openingVarianceType === "SHORTAGE" ? "shortage" : "surplus";

      await notificationService.notifyRoles({
        locationId,
        roles: ["owner", "admin", "manager"],
        actorUserId: cashierId,
        type: "CASH_SESSION_OPENING_VARIANCE",
        title: `Opening cash ${varianceWord} detected`,
        body:
          `Expected opening cash was ${expectedOpeningBalance} RWF, ` +
          `but actual opening cash was ${actualOpeningBalance} RWF. ` +
          `Difference: ${diffAbs} RWF (${openingVarianceType}). ` +
          `Reason: ${cleanReason || "-"}`,
        priority: diffAbs > 1000 ? "warn" : "normal",
        entity: "cash_session",
        entityId: created.id,
        tx,
      });
    }

    return normSessionRow(created);
  });
}

async function closeSession({
  locationId,
  cashierId,
  sessionId,
  countedCash,
  closingVarianceReason,
  note,
}) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(cashSessions)
      .where(
        and(
          eq(cashSessions.id, sessionId),
          eq(cashSessions.locationId, locationId),
        ),
      );

    const session = rows[0];
    if (!session) throw makeErr("NOT_FOUND", "Cash session not found");

    if (Number(session.cashierId) !== Number(cashierId)) {
      throw makeErr("FORBIDDEN", "Forbidden");
    }

    if (String(session.status) !== "OPEN") {
      throw makeErr("BAD_STATUS", "Cash session already closed");
    }

    const countedCashInt = toInt(countedCash, null);
    if (countedCashInt == null || countedCashInt < 0) {
      throw makeErr("BAD_COUNTED_CASH", "Counted cash is required");
    }

    const expectedCash = await computeExpectedCash(tx, {
      sessionId: Number(sessionId),
      openingBalance: Number(session.openingBalance ?? 0),
    });

    const closingVarianceAmount = countedCashInt - expectedCash;
    const closingVarianceType = getVarianceType(closingVarianceAmount);

    const cleanVarianceReason =
      typeof closingVarianceReason === "string" && closingVarianceReason.trim()
        ? closingVarianceReason.trim().slice(0, 300)
        : null;

    if (closingVarianceType !== "MATCH" && !cleanVarianceReason) {
      throw makeErr(
        "CLOSING_VARIANCE_REASON_REQUIRED",
        "Explain why the counted cash is different from the expected cash",
      );
    }

    const cleanNote =
      typeof note === "string" && note.trim()
        ? note.trim().slice(0, 200)
        : null;

    const [updated] = await tx
      .update(cashSessions)
      .set({
        status: "CLOSED",
        closingBalance: countedCashInt,
        expectedClosingBalance: expectedCash,
        countedClosingBalance: countedCashInt,
        closingVarianceAmount,
        closingVarianceType,
        closingVarianceReason: cleanVarianceReason,
        closingNote: cleanNote,
        closedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(cashSessions.id, sessionId))
      .returning();

    await tx.insert(auditLogs).values({
      locationId,
      userId: cashierId,
      action: "CASH_SESSION_CLOSE",
      entity: "cash_session",
      entityId: sessionId,
      description:
        `Cash session closed. expectedClosingBalance=${expectedCash}, ` +
        `countedClosingBalance=${countedCashInt}, ` +
        `closingVarianceAmount=${closingVarianceAmount}, ` +
        `closingVarianceType=${closingVarianceType}, ` +
        `reason=${cleanVarianceReason || "-"}, note=${cleanNote || "-"}`,
      meta: {
        expectedClosingBalance: expectedCash,
        countedClosingBalance: countedCashInt,
        closingVarianceAmount,
        closingVarianceType,
        closingVarianceReason: cleanVarianceReason,
        closingNote: cleanNote,
      },
    });

    if (closingVarianceType !== "MATCH") {
      const diffAbs = Math.abs(closingVarianceAmount);
      const varianceWord =
        closingVarianceType === "SHORTAGE" ? "shortage" : "surplus";

      await notificationService.notifyRoles({
        locationId,
        roles: ["owner", "admin", "manager"],
        actorUserId: cashierId,
        type: "CASH_SESSION_CLOSING_VARIANCE",
        title: `Closing cash ${varianceWord} detected`,
        body:
          `Expected closing cash was ${expectedCash} RWF, ` +
          `but counted cash was ${countedCashInt} RWF. ` +
          `Difference: ${diffAbs} RWF (${closingVarianceType}). ` +
          `Reason: ${cleanVarianceReason || "-"}`,
        priority: diffAbs > 1000 ? "warn" : "normal",
        entity: "cash_session",
        entityId: updated.id,
        tx,
      });
    }

    return normSessionRow(updated);
  });
}

async function listMySessions({ locationId, cashierId, limit = 30 }) {
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 200);

  const rows = await db
    .select()
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.locationId, locationId),
        eq(cashSessions.cashierId, cashierId),
      ),
    )
    .orderBy(desc(cashSessions.id))
    .limit(lim);

  return (rows || []).map(normSessionRow);
}

module.exports = { openSession, closeSession, listMySessions };
