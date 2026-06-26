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

      /* CREDIT CUSTOMER PAYMENTS -> IN */
      SELECT
        cp.id::bigint as id,
        'CUSTOMER_CREDIT_PAYMENT'::text as "movementType",
        'IN'::text as direction,

        cp.sale_id::bigint as "saleId",
        NULL::bigint as "billId",
        NULL::bigint as "expenseId",
        NULL::bigint as "refundId",
        NULL::bigint as "depositId",
        NULL::bigint as "ownerLoanId",
        NULL::bigint as "repaymentId",

        cp.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        cp.received_by::bigint as "actorUserId",
        u.name as "actorName",

        cp.received_by::bigint as "cashierId",
        u.name as "cashierName",

        COALESCE(c.name, s.customer_name)::text as "customerName",
        COALESCE(c.phone, s.customer_phone)::text as "customerPhone",

        NULL::text as "supplierName",
        NULL::text as "payeeName",

        COALESCE(cp.amount, 0)::bigint as amount,
        UPPER(COALESCE(cp.method::text, 'OTHER'))::text as method,
        cp.reference::text as reference,
        cp.note::text as note,
        cp.cash_session_id::bigint as "cashSessionId",
        cp.created_at as "createdAt"
      FROM credit_payments cp
      JOIN locations l
        ON l.id = cp.location_id
      LEFT JOIN users u
        ON u.id = cp.received_by
      LEFT JOIN sales s
        ON s.id = cp.sale_id
       AND s.location_id = cp.location_id
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

      UNION ALL

      /* BUSINESS LOAN RECEIVED / REPAYMENT / VOID -> CASH LEDGER */
      SELECT
        cl.id::bigint as id,
        CASE
          WHEN UPPER(COALESCE(cl.type::text, '')) = 'BUSINESS_LOAN_RECEIVED'
            THEN 'BUSINESS_LOAN_RECEIVED_IN'
          WHEN UPPER(COALESCE(cl.type::text, '')) = 'BUSINESS_LOAN_REPAYMENT'
            THEN 'BUSINESS_LOAN_REPAYMENT_OUT'
          WHEN UPPER(COALESCE(cl.type::text, '')) = 'BUSINESS_LOAN_VOID'
            THEN 'BUSINESS_LOAN_VOID_OUT'
          ELSE UPPER(COALESCE(cl.type::text, 'BUSINESS_LOAN_MOVEMENT'))
        END::text as "movementType",
        UPPER(COALESCE(cl.direction::text, 'OUT'))::text as direction,

        NULL::bigint as "saleId",
        NULL::bigint as "billId",
        NULL::bigint as "expenseId",
        NULL::bigint as "refundId",
        NULL::bigint as "depositId",
        NULL::bigint as "ownerLoanId",
        cl.business_loan_repayment_id::bigint as "repaymentId",

        cl.location_id::bigint as "locationId",
        l.name as "locationName",
        l.code as "locationCode",

        cl.cashier_id::bigint as "actorUserId",
        u.name as "actorName",

        cl.cashier_id::bigint as "cashierId",
        u.name as "cashierName",

        c.name::text as "customerName",
        c.phone::text as "customerPhone",

        NULL::text as "supplierName",
        blr.lender_name::text as "payeeName",

        COALESCE(cl.amount, 0)::bigint as amount,
        UPPER(COALESCE(cl.method::text, 'OTHER'))::text as method,
        COALESCE(blrp.reference, blr.reference)::text as reference,
        cl.note::text as note,
        NULL::bigint as "cashSessionId",
        cl.created_at as "createdAt"
      FROM cash_ledger cl
      JOIN locations l
        ON l.id = cl.location_id
      LEFT JOIN users u
        ON u.id = cl.cashier_id
      LEFT JOIN business_loans_received blr
        ON blr.id = cl.business_loan_received_id
      LEFT JOIN business_loan_repayments blrp
        ON blrp.id = cl.business_loan_repayment_id
      LEFT JOIN customers c
        ON c.id = blr.customer_id
      WHERE UPPER(COALESCE(cl.type::text, '')) IN (
        'BUSINESS_LOAN_RECEIVED',
        'BUSINESS_LOAN_REPAYMENT',
        'BUSINESS_LOAN_VOID'
      )
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
          COUNT(*) FILTER (WHERE omm."movementType" IN ('CUSTOMER_PAYMENT', 'CUSTOMER_CREDIT_PAYMENT', 'OWNER_LOAN_REPAYMENT_IN'))::int as "paymentsCount",
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
          COUNT(*) FILTER (WHERE omm."movementType" IN ('CUSTOMER_PAYMENT', 'CUSTOMER_CREDIT_PAYMENT', 'OWNER_LOAN_REPAYMENT_IN'))::int as "paymentsCount",
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

function normalizeOwnerLoanRow(r) {
  if (!r) return null;

  const principalAmount =
    Number(r.principalAmount ?? r.principal_amount ?? 0) || 0;
  const repaidAmount = Number(r.repaidAmount ?? r.repaid_amount ?? 0) || 0;

  return {
    id: toInt(r.id, null),
    locationId: toInt(r.locationId ?? r.location_id, null),
    locationName: r.locationName ?? r.location_name ?? null,
    locationCode: r.locationCode ?? r.location_code ?? null,
    customerId: toInt(r.customerId ?? r.customer_id, null),
    customerName: r.customerName ?? r.customer_name ?? null,
    customerPhone: r.customerPhone ?? r.customer_phone ?? null,
    receiverName: r.receiverName ?? r.receiver_name ?? null,
    principalAmount,
    repaidAmount,
    remainingAmount: Math.max(0, principalAmount - repaidAmount),
    status: String(r.status || "OPEN").toUpperCase(),
    method: r.method ?? r.disbursement_method ?? null,
    reference: r.reference ?? null,
    note: r.note ?? null,
    disbursedAt: r.disbursedAt ?? r.disbursed_at ?? null,
    createdAt: r.createdAt ?? r.created_at ?? null,
    createdByUserId: toInt(r.createdByUserId ?? r.created_by_user_id, null),
    createdByName: r.createdByName ?? r.created_by_name ?? null,
  };
}

async function listOwnerLoans({
  locationId,
  status,
  q,
  limit = 50,
  offset = 0,
}) {
  const locId = toInt(locationId, null);
  const lim = clampLimit(limit, 50, 200);
  const off = clampOffset(offset);
  const statusValue = String(status || "")
    .trim()
    .toUpperCase();
  const qValue = String(q || "").trim();

  const whereStatus = statusValue
    ? sql`AND UPPER(COALESCE(ol.status::text, 'OPEN')) = ${statusValue}`
    : sql``;
  const whereQ = qValue
    ? sql`AND (
        CAST(ol.id AS text) ILIKE ${`%${qValue}%`}
        OR COALESCE(ol.receiver_name, '') ILIKE ${`%${qValue}%`}
        OR COALESCE(ol.reference, '') ILIKE ${`%${qValue}%`}
        OR COALESCE(ol.note, '') ILIKE ${`%${qValue}%`}
        OR COALESCE(c.name, '') ILIKE ${`%${qValue}%`}
        OR COALESCE(c.phone, '') ILIKE ${`%${qValue}%`}
        OR COALESCE(l.name, '') ILIKE ${`%${qValue}%`}
        OR COALESCE(l.code, '') ILIKE ${`%${qValue}%`}
      )`
    : sql``;

  const rowsRes = await db.execute(sql`
    SELECT
      ol.id,
      ol.location_id as "locationId",
      l.name as "locationName",
      l.code as "locationCode",
      ol.customer_id as "customerId",
      c.name as "customerName",
      c.phone as "customerPhone",
      ol.receiver_name as "receiverName",
      ol.principal_amount as "principalAmount",
      ol.repaid_amount as "repaidAmount",
      ol.status,
      ol.disbursement_method as "method",
      ol.reference,
      ol.note,
      ol.disbursed_at as "disbursedAt",
      ol.created_at as "createdAt",
      ol.created_by_user_id as "createdByUserId",
      u.name as "createdByName"
    FROM owner_loans ol
    JOIN locations l
      ON l.id = ol.location_id
    LEFT JOIN customers c
      ON c.id = ol.customer_id
    LEFT JOIN users u
      ON u.id = ol.created_by_user_id
    WHERE 1 = 1
      ${locId ? sql`AND ol.location_id = ${locId}` : sql``}
      ${whereStatus}
      ${whereQ}
    ORDER BY ol.id DESC
    LIMIT ${lim}
    OFFSET ${off}
  `);

  const summaryRes = await db.execute(sql`
    SELECT
      COUNT(*)::int as "count",
      COUNT(*) FILTER (WHERE UPPER(COALESCE(status::text, 'OPEN')) = 'OPEN')::int as "openCount",
      COUNT(*) FILTER (WHERE UPPER(COALESCE(status::text, 'OPEN')) = 'VOID')::int as "voidCount",
      COALESCE(SUM(principal_amount), 0)::bigint as "principalAmount",
      COALESCE(SUM(repaid_amount), 0)::bigint as "repaidAmount",
      COALESCE(SUM(GREATEST(principal_amount - repaid_amount, 0)), 0)::bigint as "remainingAmount"
    FROM owner_loans ol
    WHERE 1 = 1
      ${locId ? sql`AND ol.location_id = ${locId}` : sql``}
      ${whereStatus}
  `);

  const rows = rowsOf(rowsRes).map(normalizeOwnerLoanRow).filter(Boolean);
  const s = rowsOf(summaryRes)[0] || {};

  return {
    rows,
    summary: {
      count: Number(s.count || 0),
      openCount: Number(s.openCount || 0),
      voidCount: Number(s.voidCount || 0),
      principalAmount: Number(s.principalAmount || 0),
      repaidAmount: Number(s.repaidAmount || 0),
      remainingAmount: Number(s.remainingAmount || 0),
    },
    pagination: {
      limit: lim,
      offset: off,
      count: rows.length,
    },
  };
}

async function voidOwnerLoan({ loanId, actorUserId, reason }) {
  const id = toInt(loanId, null);
  const actorId = toInt(actorUserId, null);
  const cleanReason = String(reason || "")
    .trim()
    .slice(0, 300);

  if (!id || id <= 0) {
    const err = new Error("Valid owner loan id is required");
    err.code = "BAD_LOAN_ID";
    throw err;
  }

  if (!actorId || actorId <= 0) {
    const err = new Error("Valid actor user is required");
    err.code = "BAD_ACTOR";
    throw err;
  }

  if (!cleanReason || cleanReason.length < 3) {
    const err = new Error("Void reason is required");
    err.code = "BAD_VOID_REASON";
    throw err;
  }

  return db.transaction(async (tx) => {
    const foundRes = await tx.execute(sql`
      SELECT *
      FROM owner_loans
      WHERE id = ${id}
      LIMIT 1
    `);

    const found = rowsOf(foundRes)[0];

    if (!found) {
      const err = new Error("Owner loan not found");
      err.code = "OWNER_LOAN_NOT_FOUND";
      throw err;
    }

    const currentStatus = String(found.status || "OPEN").toUpperCase();
    const repaidAmount =
      Number(found.repaid_amount ?? found.repaidAmount ?? 0) || 0;

    if (currentStatus === "VOID") {
      return normalizeOwnerLoanRow(found);
    }

    if (repaidAmount > 0) {
      const err = new Error("Owner loan with repayments cannot be voided");
      err.code = "OWNER_LOAN_NOT_VOIDABLE";
      throw err;
    }

    const nextNote =
      `${String(found.note || "").trim()}\n[VOIDED] ${cleanReason}`.trim();

    const updatedRes = await tx.execute(sql`
      UPDATE owner_loans
      SET
        status = 'VOID',
        note = ${nextNote}
      WHERE id = ${id}
      RETURNING *
    `);

    const updated = rowsOf(updatedRes)[0];

    await tx.execute(sql`
      INSERT INTO audit_logs (
        location_id,
        user_id,
        action,
        entity,
        entity_id,
        description
      )
      VALUES (
        ${Number(found.location_id || found.locationId)},
        ${actorId},
        'OWNER_LOAN_VOID',
        'owner_loan',
        ${id},
        ${`Owner loan #${id} voided. Reason: ${cleanReason}`}
      )
    `);

    return normalizeOwnerLoanRow(updated);
  });
}

module.exports = {
  listOwnerPayments,
  getOwnerPaymentsSummary,
  getOwnerPaymentsBreakdown,
  listOwnerLoans,
  voidOwnerLoan,
};
