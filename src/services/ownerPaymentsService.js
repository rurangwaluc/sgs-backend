"use strict";

const { db } = require("../config/db");
const { sql } = require("drizzle-orm");

function rowsOf(result) {
  return result?.rows || result || [];
}

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function clampLimit(n, def = 50, max = 200) {
  const x = toInt(n, def);
  if (!Number.isInteger(x) || x <= 0) return def;
  return Math.min(x, max);
}

function clampOffset(n) {
  const x = toInt(n, 0);
  if (!Number.isInteger(x) || x < 0) return 0;
  return x;
}

function normalizeMethod(v) {
  const m = String(v || "")
    .trim()
    .toUpperCase();

  if (["CASH", "MOMO", "BANK", "CARD", "OTHER"].includes(m)) return m;
  return "";
}

function buildFilterSql({ locationId, method, dateFrom, dateTo }) {
  const parsedLocationId = toInt(locationId, null);
  const normalizedMethod = normalizeMethod(method);

  const dateFromTs = dateFrom ? new Date(dateFrom) : null;
  const dateToTs = dateTo ? new Date(dateTo) : null;
  const dateToNextDay = dateToTs
    ? new Date(dateToTs.getTime() + 24 * 60 * 60 * 1000)
    : null;

  return {
    parsedLocationId,
    normalizedMethod,
    dateFromTs,
    dateToNextDay,
  };
}

function normalizeMovementRow(r) {
  if (!r) return null;

  return {
    id: toInt(r.id, null),
    movementType: r.movementType ?? null,
    direction: r.direction ?? null,

    saleId: toInt(r.saleId ?? r.sale_id, null),
    billId: toInt(r.billId ?? r.bill_id, null),
    expenseId: toInt(r.expenseId ?? r.expense_id, null),
    refundId: toInt(r.refundId ?? r.refund_id, null),
    depositId: toInt(r.depositId ?? r.deposit_id, null),
    ownerLoanId: toInt(r.ownerLoanId ?? r.owner_loan_id, null),
    repaymentId: toInt(r.repaymentId ?? r.repayment_id, null),

    location: {
      id: String(toInt(r.locationId ?? r.location_id, null) || ""),
      name: r.locationName ?? r.location_name ?? null,
      code: r.locationCode ?? r.location_code ?? null,
    },

    actorUserId: toInt(r.actorUserId ?? r.actor_user_id, null),
    actorName: r.actorName ?? r.actor_name ?? null,

    cashierId: toInt(r.cashierId ?? r.cashier_id, null),
    cashierName: r.cashierName ?? r.cashier_name ?? null,

    customerName: r.customerName ?? r.customer_name ?? null,
    customerPhone: r.customerPhone ?? r.customer_phone ?? null,

    supplierName: r.supplierName ?? r.supplier_name ?? null,
    payeeName: r.payeeName ?? r.payee_name ?? null,

    amount: Number(r.amount ?? 0) || 0,
    method: r.method ?? null,
    reference: r.reference ?? null,
    note: r.note ?? null,
    cashSessionId: toInt(r.cashSessionId ?? r.cash_session_id, null),
    createdAt: r.createdAt ?? r.created_at ?? null,
  };
}

function buildMovementsQuery({
  parsedLocationId,
  normalizedMethod,
  dateFromTs,
  dateToNextDay,
  selectClause,
  orderClause = sql`ORDER BY omm."createdAt" DESC, omm.direction ASC, omm.id DESC`,
  limitClause = sql``,
  offsetClause = sql``,
}) {
  return sql`
    WITH owner_money_movements AS (
      /* CUSTOMER PAYMENTS -> IN */
      SELECT
        p.id::bigint as id,
        'CUSTOMER_PAYMENT'::text as "movementType",
        'IN'::text as direction,

        p.sale_id::bigint as "saleId",
        NULL::bigint as "billId",
        NULL::bigint as "expenseId",
        NULL::bigint as "refundId",
        NULL::bigint as "depositId",
        NULL::bigint as "ownerLoanId",
        NULL::bigint as "repaymentId",

        p.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        p.cashier_id::bigint as "actorUserId",
        u.name as "actorName",

        p.cashier_id::bigint as "cashierId",
        u.name as "cashierName",

        COALESCE(c.name, s.customer_name)::text as "customerName",
        COALESCE(c.phone, s.customer_phone)::text as "customerPhone",

        NULL::text as "supplierName",
        NULL::text as "payeeName",

        COALESCE(p.amount, 0)::bigint as amount,
        UPPER(COALESCE(p.method::text, 'OTHER'))::text as method,
        NULL::text as reference,
        p.note::text as note,
        p.cash_session_id::bigint as "cashSessionId",
        p.created_at as "createdAt"
      FROM payments p
      JOIN locations l
        ON l.id = p.location_id
      LEFT JOIN users u
        ON u.id = p.cashier_id
      LEFT JOIN sales s
        ON s.id = p.sale_id
       AND s.location_id = p.location_id
      LEFT JOIN customers c
        ON c.id = s.customer_id
       AND c.location_id = s.location_id

      UNION ALL

      /* SUPPLIER BILL PAYMENTS -> OUT */
      SELECT
        sbp.id::bigint as id,
        'SUPPLIER_BILL_PAYMENT'::text as "movementType",
        'OUT'::text as direction,

        NULL::bigint as "saleId",
        sbp.bill_id::bigint as "billId",
        NULL::bigint as "expenseId",
        NULL::bigint as "refundId",
        NULL::bigint as "depositId",
        NULL::bigint as "ownerLoanId",
        NULL::bigint as "repaymentId",

        sb.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        sbp.created_by_user_id::bigint as "actorUserId",
        u.name as "actorName",

        NULL::bigint as "cashierId",
        NULL::text as "cashierName",

        NULL::text as "customerName",
        NULL::text as "customerPhone",

        sup.name::text as "supplierName",
        NULL::text as "payeeName",

        COALESCE(sbp.amount, 0)::bigint as amount,
        UPPER(COALESCE(sbp.method::text, 'OTHER'))::text as method,
        sbp.reference::text as reference,
        sbp.note::text as note,
        NULL::bigint as "cashSessionId",
        COALESCE(sbp.paid_at, sbp.created_at) as "createdAt"
      FROM supplier_bill_payments sbp
      JOIN supplier_bills sb
        ON sb.id = sbp.bill_id
      JOIN locations l
        ON l.id = sb.location_id
      LEFT JOIN suppliers sup
        ON sup.id = sb.supplier_id
      LEFT JOIN users u
        ON u.id = sbp.created_by_user_id

      UNION ALL

      /* POSTED EXPENSES -> OUT */
      SELECT
        e.id::bigint as id,
        'EXPENSE'::text as "movementType",
        'OUT'::text as direction,

        NULL::bigint as "saleId",
        NULL::bigint as "billId",
        e.id::bigint as "expenseId",
        NULL::bigint as "refundId",
        NULL::bigint as "depositId",
        NULL::bigint as "ownerLoanId",
        NULL::bigint as "repaymentId",

        e.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        e.cashier_id::bigint as "actorUserId",
        u.name as "actorName",

        e.cashier_id::bigint as "cashierId",
        u.name as "cashierName",

        NULL::text as "customerName",
        NULL::text as "customerPhone",

        NULL::text as "supplierName",
        e.payee_name::text as "payeeName",

        COALESCE(e.amount, 0)::bigint as amount,
        UPPER(COALESCE(e.method::text, 'OTHER'))::text as method,
        e.reference::text as reference,
        e.note::text as note,
        e.cash_session_id::bigint as "cashSessionId",
        COALESCE(e.expense_date, e.created_at) as "createdAt"
      FROM expenses e
      JOIN locations l
        ON l.id = e.location_id
      LEFT JOIN users u
        ON u.id = e.cashier_id
      WHERE UPPER(COALESCE(e.status::text, 'POSTED')) = 'POSTED'

      UNION ALL

      /* REFUNDS -> OUT */
      SELECT
        r.id::bigint as id,
        'REFUND'::text as "movementType",
        'OUT'::text as direction,

        r.sale_id::bigint as "saleId",
        NULL::bigint as "billId",
        NULL::bigint as "expenseId",
        r.id::bigint as "refundId",
        NULL::bigint as "depositId",
        NULL::bigint as "ownerLoanId",
        NULL::bigint as "repaymentId",

        r.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        r.created_by_user_id::bigint as "actorUserId",
        u.name as "actorName",

        r.created_by_user_id::bigint as "cashierId",
        u.name as "cashierName",

        COALESCE(c.name, s.customer_name)::text as "customerName",
        COALESCE(c.phone, s.customer_phone)::text as "customerPhone",

        NULL::text as "supplierName",
        NULL::text as "payeeName",

        COALESCE(r.total_amount, 0)::bigint as amount,
        UPPER(COALESCE(r.method::text, 'OTHER'))::text as method,
        r.reference::text as reference,
        r.reason::text as note,
        r.cash_session_id::bigint as "cashSessionId",
        r.created_at as "createdAt"
      FROM refunds r
      JOIN locations l
        ON l.id = r.location_id
      LEFT JOIN users u
        ON u.id = r.created_by_user_id
      LEFT JOIN sales s
        ON s.id = r.sale_id
       AND s.location_id = r.location_id
      LEFT JOIN customers c
        ON c.id = s.customer_id
       AND c.location_id = s.location_id

      UNION ALL

      /* CASHBOOK DEPOSITS / MONEY SENT OUT -> OUT */
      SELECT
        d.id::bigint as id,
        'DEPOSIT_OUT'::text as "movementType",
        'OUT'::text as direction,

        NULL::bigint as "saleId",
        NULL::bigint as "billId",
        NULL::bigint as "expenseId",
        NULL::bigint as "refundId",
        d.id::bigint as "depositId",
        NULL::bigint as "ownerLoanId",
        NULL::bigint as "repaymentId",

        d.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        d.cashier_id::bigint as "actorUserId",
        u.name as "actorName",

        d.cashier_id::bigint as "cashierId",
        u.name as "cashierName",

        NULL::text as "customerName",
        NULL::text as "customerPhone",

        NULL::text as "supplierName",
        NULL::text as "payeeName",

        COALESCE(d.amount, 0)::bigint as amount,
        UPPER(COALESCE(d.method::text, 'OTHER'))::text as method,
        d.reference::text as reference,
        d.note::text as note,
        d.cash_session_id::bigint as "cashSessionId",
        d.created_at as "createdAt"
      FROM cashbook_deposits d
      JOIN locations l
        ON l.id = d.location_id
      LEFT JOIN users u
        ON u.id = d.cashier_id

      UNION ALL

      /* OWNER LOAN DISBURSEMENT -> OUT */
      SELECT
        ol.id::bigint as id,
        'OWNER_LOAN_OUT'::text as "movementType",
        'OUT'::text as direction,

        NULL::bigint as "saleId",
        NULL::bigint as "billId",
        NULL::bigint as "expenseId",
        NULL::bigint as "refundId",
        NULL::bigint as "depositId",
        ol.id::bigint as "ownerLoanId",
        NULL::bigint as "repaymentId",

        ol.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        ol.created_by_user_id::bigint as "actorUserId",
        u.name as "actorName",

        NULL::bigint as "cashierId",
        NULL::text as "cashierName",

        c.name::text as "customerName",
        c.phone::text as "customerPhone",

        NULL::text as "supplierName",
        ol.receiver_name::text as "payeeName",

        COALESCE(ol.principal_amount, 0)::bigint as amount,
        UPPER(COALESCE(ol.disbursement_method::text, 'OTHER'))::text as method,
        ol.reference::text as reference,
        ol.note::text as note,
        NULL::bigint as "cashSessionId",
        COALESCE(ol.disbursed_at, ol.created_at) as "createdAt"
      FROM owner_loans ol
      JOIN locations l
        ON l.id = ol.location_id
      LEFT JOIN users u
        ON u.id = ol.created_by_user_id
      LEFT JOIN customers c
        ON c.id = ol.customer_id
      WHERE UPPER(COALESCE(ol.status::text, 'OPEN')) <> 'VOID'

      UNION ALL

      /* OWNER LOAN REPAYMENT -> IN */
      SELECT
        olr.id::bigint as id,
        'OWNER_LOAN_REPAYMENT_IN'::text as "movementType",
        'IN'::text as direction,

        NULL::bigint as "saleId",
        NULL::bigint as "billId",
        NULL::bigint as "expenseId",
        NULL::bigint as "refundId",
        NULL::bigint as "depositId",
        olr.owner_loan_id::bigint as "ownerLoanId",
        olr.id::bigint as "repaymentId",

        ol.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        olr.created_by_user_id::bigint as "actorUserId",
        u.name as "actorName",

        NULL::bigint as "cashierId",
        NULL::text as "cashierName",

        c.name::text as "customerName",
        c.phone::text as "customerPhone",

        NULL::text as "supplierName",
        ol.receiver_name::text as "payeeName",

        COALESCE(olr.amount, 0)::bigint as amount,
        UPPER(COALESCE(olr.method::text, 'OTHER'))::text as method,
        olr.reference::text as reference,
        olr.note::text as note,
        NULL::bigint as "cashSessionId",
        COALESCE(olr.paid_at, olr.created_at) as "createdAt"
      FROM owner_loan_repayments olr
      JOIN owner_loans ol
        ON ol.id = olr.owner_loan_id
      JOIN locations l
        ON l.id = ol.location_id
      LEFT JOIN users u
        ON u.id = olr.created_by_user_id
      LEFT JOIN customers c
        ON c.id = ol.customer_id
      WHERE UPPER(COALESCE(ol.status::text, 'OPEN')) <> 'VOID'
    )
    ${selectClause}
    FROM owner_money_movements omm
    WHERE 1 = 1
      ${parsedLocationId ? sql`AND omm."locationId" = ${parsedLocationId}` : sql``}
      ${normalizedMethod ? sql`AND UPPER(COALESCE(omm.method, '')) = ${normalizedMethod}` : sql``}
      ${dateFromTs ? sql`AND omm."createdAt" >= ${dateFromTs}` : sql``}
      ${dateToNextDay ? sql`AND omm."createdAt" < ${dateToNextDay}` : sql``}
    ${orderClause}
    ${limitClause}
    ${offsetClause}
  `;
}

async function listOwnerPayments({
  locationId,
  method,
  dateFrom,
  dateTo,
  limit = 50,
  offset = 0,
}) {
  const { parsedLocationId, normalizedMethod, dateFromTs, dateToNextDay } =
    buildFilterSql({ locationId, method, dateFrom, dateTo });

  const lim = clampLimit(limit, 50, 200);
  const off = clampOffset(offset);

  const res = await db.execute(
    buildMovementsQuery({
      parsedLocationId,
      normalizedMethod,
      dateFromTs,
      dateToNextDay,
      selectClause: sql`
        SELECT
          omm.id,
          omm."movementType",
          omm.direction,
          omm."saleId",
          omm."billId",
          omm."expenseId",
          omm."refundId",
          omm."depositId",
          omm."ownerLoanId",
          omm."repaymentId",
          omm."locationId",
          omm."locationName",
          omm."locationCode",
          omm."actorUserId",
          omm."actorName",
          omm."cashierId",
          omm."cashierName",
          omm."customerName",
          omm."customerPhone",
          omm."supplierName",
          omm."payeeName",
          omm.amount,
          omm.method,
          omm.reference,
          omm.note,
          omm."cashSessionId",
          omm."createdAt"
      `,
      orderClause: sql`ORDER BY omm."createdAt" DESC, omm.direction ASC, omm.id DESC`,
      limitClause: sql`LIMIT ${lim}`,
      offsetClause: sql`OFFSET ${off}`,
    }),
  );

  return rowsOf(res).map(normalizeMovementRow).filter(Boolean);
}

async function getOwnerPaymentsSummary({
  locationId,
  method,
  dateFrom,
  dateTo,
}) {
  const { parsedLocationId, normalizedMethod, dateFromTs, dateToNextDay } =
    buildFilterSql({ locationId, method, dateFrom, dateTo });

  const totalsRes = await db.execute(
    buildMovementsQuery({
      parsedLocationId,
      normalizedMethod,
      dateFromTs,
      dateToNextDay,
      selectClause: sql`
        SELECT
          COUNT(DISTINCT omm."locationId")::int as "branchesCount",
          COUNT(*)::int as "movementsCount",
          COUNT(*) FILTER (WHERE omm.direction = 'IN')::int as "moneyInCount",
          COUNT(*) FILTER (WHERE omm.direction = 'OUT')::int as "moneyOutCount",
          COUNT(*) FILTER (WHERE omm."movementType" IN ('CUSTOMER_PAYMENT', 'OWNER_LOAN_REPAYMENT_IN'))::int as "paymentsCount",
          COALESCE(SUM(CASE WHEN omm.direction = 'IN' THEN omm.amount ELSE 0 END), 0)::bigint as "totalMoneyIn",
          COALESCE(SUM(CASE WHEN omm.direction = 'OUT' THEN omm.amount ELSE 0 END), 0)::bigint as "totalMoneyOut",
          COALESCE(SUM(CASE WHEN omm.direction = 'IN' THEN omm.amount ELSE -omm.amount END), 0)::bigint as "netAmount"
      `,
      orderClause: sql``,
    }),
  );

  const byLocationRes = await db.execute(
    buildMovementsQuery({
      parsedLocationId,
      normalizedMethod,
      dateFromTs,
      dateToNextDay,
      selectClause: sql`
        SELECT
          omm."locationId"::int as "locationId",
          omm."locationName" as "locationName",
          omm."locationCode" as "locationCode",
          COUNT(*)::int as "movementsCount",
          COUNT(*) FILTER (WHERE omm.direction = 'IN')::int as "moneyInCount",
          COUNT(*) FILTER (WHERE omm.direction = 'OUT')::int as "moneyOutCount",
          COUNT(*) FILTER (WHERE omm."movementType" IN ('CUSTOMER_PAYMENT', 'OWNER_LOAN_REPAYMENT_IN'))::int as "paymentsCount",
          COALESCE(SUM(CASE WHEN omm.direction = 'IN' THEN omm.amount ELSE 0 END), 0)::bigint as "totalMoneyIn",
          COALESCE(SUM(CASE WHEN omm.direction = 'OUT' THEN omm.amount ELSE 0 END), 0)::bigint as "totalMoneyOut",
          COALESCE(SUM(CASE WHEN omm.direction = 'IN' THEN omm.amount ELSE -omm.amount END), 0)::bigint as "netAmount"
      `,
      orderClause: sql`
        GROUP BY omm."locationId", omm."locationName", omm."locationCode"
        ORDER BY omm."locationName" ASC
      `,
    }),
  );

  const totalsRow = rowsOf(totalsRes)[0] || {};

  return {
    totals: {
      branchesCount: Number(totalsRow?.branchesCount ?? 0),
      movementsCount: Number(totalsRow?.movementsCount ?? 0),
      moneyInCount: Number(totalsRow?.moneyInCount ?? 0),
      moneyOutCount: Number(totalsRow?.moneyOutCount ?? 0),
      paymentsCount: Number(totalsRow?.paymentsCount ?? 0),
      totalMoneyIn: Number(totalsRow?.totalMoneyIn ?? 0),
      totalMoneyOut: Number(totalsRow?.totalMoneyOut ?? 0),
      netAmount: Number(totalsRow?.netAmount ?? 0),
      totalAmount: Number(totalsRow?.totalMoneyIn ?? 0),
    },

    byLocation: rowsOf(byLocationRes).map((r) => ({
      locationId: Number(r?.locationId ?? 0),
      locationName: r?.locationName ?? null,
      locationCode: r?.locationCode ?? null,
      movementsCount: Number(r?.movementsCount ?? 0),
      moneyInCount: Number(r?.moneyInCount ?? 0),
      moneyOutCount: Number(r?.moneyOutCount ?? 0),
      paymentsCount: Number(r?.paymentsCount ?? 0),
      totalMoneyIn: Number(r?.totalMoneyIn ?? 0),
      totalMoneyOut: Number(r?.totalMoneyOut ?? 0),
      netAmount: Number(r?.netAmount ?? 0),
      totalAmount: Number(r?.totalMoneyIn ?? 0),
    })),
  };
}

async function getOwnerPaymentsBreakdown({
  locationId,
  method,
  dateFrom,
  dateTo,
}) {
  const { parsedLocationId, normalizedMethod, dateFromTs, dateToNextDay } =
    buildFilterSql({ locationId, method, dateFrom, dateTo });

  const byMethodRes = await db.execute(
    buildMovementsQuery({
      parsedLocationId,
      normalizedMethod,
      dateFromTs,
      dateToNextDay,
      selectClause: sql`
        SELECT
          UPPER(COALESCE(omm.method, 'OTHER')) as "method",
          COUNT(*)::int as "count",
          COUNT(*) FILTER (WHERE omm.direction = 'IN')::int as "moneyInCount",
          COUNT(*) FILTER (WHERE omm.direction = 'OUT')::int as "moneyOutCount",
          COALESCE(SUM(CASE WHEN omm.direction = 'IN' THEN omm.amount ELSE 0 END), 0)::bigint as "totalMoneyIn",
          COALESCE(SUM(CASE WHEN omm.direction = 'OUT' THEN omm.amount ELSE 0 END), 0)::bigint as "totalMoneyOut",
          COALESCE(SUM(CASE WHEN omm.direction = 'IN' THEN omm.amount ELSE -omm.amount END), 0)::bigint as "netAmount"
      `,
      orderClause: sql`
        GROUP BY 1
        ORDER BY "netAmount" DESC, "method" ASC
      `,
    }),
  );

  const byLocationMethodRes = await db.execute(
    buildMovementsQuery({
      parsedLocationId,
      normalizedMethod,
      dateFromTs,
      dateToNextDay,
      selectClause: sql`
        SELECT
          omm."locationId"::int as "locationId",
          omm."locationName" as "locationName",
          omm."locationCode" as "locationCode",
          UPPER(COALESCE(omm.method, 'OTHER')) as "method",
          COUNT(*)::int as "count",
          COUNT(*) FILTER (WHERE omm.direction = 'IN')::int as "moneyInCount",
          COUNT(*) FILTER (WHERE omm.direction = 'OUT')::int as "moneyOutCount",
          COALESCE(SUM(CASE WHEN omm.direction = 'IN' THEN omm.amount ELSE 0 END), 0)::bigint as "totalMoneyIn",
          COALESCE(SUM(CASE WHEN omm.direction = 'OUT' THEN omm.amount ELSE 0 END), 0)::bigint as "totalMoneyOut",
          COALESCE(SUM(CASE WHEN omm.direction = 'IN' THEN omm.amount ELSE -omm.amount END), 0)::bigint as "netAmount"
      `,
      orderClause: sql`
        GROUP BY omm."locationId", omm."locationName", omm."locationCode", 4
        ORDER BY omm."locationName" ASC, "netAmount" DESC, "method" ASC
      `,
    }),
  );

  const byMethod = rowsOf(byMethodRes).map((r) => ({
    method: r?.method ?? "OTHER",
    count: Number(r?.count ?? 0),
    moneyInCount: Number(r?.moneyInCount ?? 0),
    moneyOutCount: Number(r?.moneyOutCount ?? 0),
    totalMoneyIn: Number(r?.totalMoneyIn ?? 0),
    totalMoneyOut: Number(r?.totalMoneyOut ?? 0),
    netAmount: Number(r?.netAmount ?? 0),
    total: Number(r?.netAmount ?? 0),
  }));

  const byLocationMethod = rowsOf(byLocationMethodRes).map((r) => ({
    locationId: Number(r?.locationId ?? 0),
    locationName: r?.locationName ?? null,
    locationCode: r?.locationCode ?? null,
    method: r?.method ?? "OTHER",
    count: Number(r?.count ?? 0),
    moneyInCount: Number(r?.moneyInCount ?? 0),
    moneyOutCount: Number(r?.moneyOutCount ?? 0),
    totalMoneyIn: Number(r?.totalMoneyIn ?? 0),
    totalMoneyOut: Number(r?.totalMoneyOut ?? 0),
    netAmount: Number(r?.netAmount ?? 0),
    total: Number(r?.netAmount ?? 0),
  }));

  return {
    byMethod,
    byLocationMethod,
  };
}

module.exports = {
  listOwnerPayments,
  getOwnerPaymentsSummary,
  getOwnerPaymentsBreakdown,
};
