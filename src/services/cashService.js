"use strict";

const { db } = require("../config/db");
const { cashLedger } = require("../db/schema/cash_ledger.schema");
const { sql } = require("drizzle-orm");
const { logAudit } = require("./auditService");
const AUDIT = require("../audit/actions");

function txMeta(type, direction, amount, method, note) {
  return { type, direction, amount, method, note };
}

async function createCashTx({
  locationId,
  cashierId,
  type,
  amount,
  method,
  note,
}) {
  const direction =
    type === "PETTY_CASH_OUT" || type === "VERSEMENT" ? "OUT" : "IN";
  const m = method || (type === "VERSEMENT" ? "BANK" : "CASH");

  const [row] = await db
    .insert(cashLedger)
    .values({
      locationId,
      cashierId,
      cashSessionId: null,
      type,
      direction,
      amount,
      method: m,
      reference: null,
      saleId: null,
      paymentId: null,
      expenseId: null,
      creditId: null,
      creditPaymentId: null,
      note: note || null,
      createdAt: new Date(),
    })
    .returning();

  await logAudit({
    userId: cashierId,
    action:
      type === "VERSEMENT"
        ? AUDIT.VERSEMENT
        : direction === "IN"
          ? AUDIT.CASH_IN
          : AUDIT.CASH_OUT,
    entity: "cash_ledger",
    entityId: row.id,
    description: `Cash transaction recorded: ${type} ${direction} ${amount}`,
    meta: txMeta(type, direction, amount, m, note),
  });

  return row;
}

async function listLedger({ locationId, cashierId = null, limit = 100 }) {
  const res = await db.execute(sql`
    SELECT
      id,
      location_id as "locationId",
      cashier_id as "cashierId",
      cash_session_id as "cashSessionId",
      type,
      direction,
      amount,
      method,
      reference,
      sale_id as "saleId",
      payment_id as "paymentId",
      expense_id as "expenseId",
      credit_id as "creditId",
      credit_payment_id as "creditPaymentId",
      note,
      created_at as "createdAt"
    FROM cash_ledger
    WHERE location_id = ${locationId}
      ${cashierId ? sql`AND cashier_id = ${cashierId}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `);

  return res.rows || res;
}

async function summaryToday({ locationId, cashierId = null }) {
  const nowKigali = sql`(now() AT TIME ZONE 'Africa/Kigali')`;
  const startKigali = sql`date_trunc('day', ${nowKigali})`;
  const endKigali = sql`${startKigali} + interval '1 day'`;

  const res = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END), 0)::bigint as "totalIn",
      COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END), 0)::bigint as "totalOut",
      (
        COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN direction = 'OUT' THEN amount ELSE 0 END), 0)
      )::bigint as "net"
    FROM cash_ledger
    WHERE location_id = ${locationId}
      ${cashierId ? sql`AND cashier_id = ${cashierId}` : sql``}
      AND (created_at AT TIME ZONE 'Africa/Kigali') >= ${startKigali}
      AND (created_at AT TIME ZONE 'Africa/Kigali') < ${endKigali}
  `);

  return (res.rows || res)[0] || { totalIn: 0, totalOut: 0, net: 0 };
}

module.exports = { createCashTx, listLedger, summaryToday };
