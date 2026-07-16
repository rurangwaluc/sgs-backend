"use strict";

const { db } = require("../config/db");
const { sql } = require("drizzle-orm");

function rowsOf(result) {
  return result?.rows || result || [];
}

function firstRow(result, fallback = {}) {
  return rowsOf(result)[0] || fallback;
}

function toInt(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toMoneyInt(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toPct(numerator, denominator) {
  const a = Number(numerator);
  const b = Number(denominator);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return Number(((a / b) * 100).toFixed(2));
}

function parseDateStart(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseDateEndExclusive(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

function buildFilters(input = {}) {
  const locationIdInt = toInt(input.locationId ?? input.branchId ?? null, null);

  const fromRaw = input.from ?? input.dateFrom ?? null;
  const toRaw = input.to ?? input.dateTo ?? null;

  return {
    locationIdInt,
    fromTs: parseDateStart(fromRaw),
    toExclusiveTs: parseDateEndExclusive(toRaw),
  };
}

function buildAsOfDate(input = {}) {
  const raw = input.asOfDate ?? input.dateTo ?? input.to ?? null;
  const asOfDate = raw ? String(raw).trim() : null;
  const asOfTs = parseDateEndExclusive(asOfDate);

  return {
    asOfDate,
    asOfTs,
  };
}

function makeMeta({
  locationIdInt = null,
  fromTs = null,
  toExclusiveTs = null,
  asOfDate = null,
  warnings = [],
} = {}) {
  return {
    locationId: locationIdInt,
    dateFrom: fromTs ? fromTs.toISOString().slice(0, 10) : null,
    dateTo: toExclusiveTs
      ? new Date(toExclusiveTs.getTime() - 1).toISOString().slice(0, 10)
      : null,
    asOfDate: asOfDate || null,
    currency: "RWF",
    warnings: Array.isArray(warnings) ? warnings.filter(Boolean) : [],
  };
}

async function getOwnerReportsOverview(input = {}) {
  const { locationIdInt, fromTs, toExclusiveTs } = buildFilters(input);

  const result = await db.execute(sql`
    SELECT
      COUNT(DISTINCT l.id)::int as "branchesCount",

      (
        SELECT COUNT(*)::int
        FROM sales s
        WHERE 1 = 1
          ${locationIdInt ? sql`AND s.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
      ) as "salesCount",

      (
        SELECT COALESCE(SUM(s.total_amount), 0)::bigint
        FROM sales s
        WHERE 1 = 1
          ${locationIdInt ? sql`AND s.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
      ) as "salesTotal",

      (
        SELECT COUNT(*)::int
        FROM payments p
        WHERE 1 = 1
          ${locationIdInt ? sql`AND p.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND p.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND p.created_at < ${toExclusiveTs}` : sql``}
      ) as "paymentsCount",

      (
        SELECT COALESCE(SUM(p.amount), 0)::bigint
        FROM payments p
        WHERE 1 = 1
          ${locationIdInt ? sql`AND p.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND p.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND p.created_at < ${toExclusiveTs}` : sql``}
      ) as "paymentsTotal",

      (
        SELECT COUNT(*)::int
        FROM credits c
        WHERE 1 = 1
          ${locationIdInt ? sql`AND c.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND c.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND c.created_at < ${toExclusiveTs}` : sql``}
      ) as "creditsCount",

      (
        SELECT COALESCE(SUM(c.principal_amount), 0)::bigint
        FROM credits c
        WHERE 1 = 1
          ${locationIdInt ? sql`AND c.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND c.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND c.created_at < ${toExclusiveTs}` : sql``}
      ) as "creditsTotal",

      (
        SELECT COALESCE(SUM(c.remaining_amount), 0)::bigint
        FROM credits c
        WHERE 1 = 1
          ${locationIdInt ? sql`AND c.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND c.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND c.created_at < ${toExclusiveTs}` : sql``}
          AND c.status IN ('APPROVED', 'PARTIALLY_PAID')
      ) as "creditsOutstandingTotal",

      (
        SELECT COUNT(*)::int
        FROM refunds r
        WHERE 1 = 1
          ${locationIdInt ? sql`AND r.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND r.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND r.created_at < ${toExclusiveTs}` : sql``}
      ) as "refundsCount",

      (
        SELECT COALESCE(SUM(r.total_amount), 0)::bigint
        FROM refunds r
        WHERE 1 = 1
          ${locationIdInt ? sql`AND r.location_id = ${locationIdInt}` : sql``}
          ${fromTs ? sql`AND r.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND r.created_at < ${toExclusiveTs}` : sql``}
      ) as "refundsTotal"
    FROM locations l
    WHERE 1 = 1
      ${locationIdInt ? sql`AND l.id = ${locationIdInt}` : sql``}
  `);

  return (
    rowsOf(result)[0] || {
      branchesCount: 0,
      salesCount: 0,
      salesTotal: 0,
      paymentsCount: 0,
      paymentsTotal: 0,
      creditsCount: 0,
      creditsTotal: 0,
      creditsOutstandingTotal: 0,
      refundsCount: 0,
      refundsTotal: 0,
    }
  );
}

async function getOwnerBranchPerformance(input = {}) {
  const { locationIdInt, fromTs, toExclusiveTs } = buildFilters(input);

  const result = await db.execute(sql`
    SELECT
      l.id::int as "locationId",
      l.name as "locationName",
      l.code as "locationCode",
      l.status as "locationStatus",
      l.is_main as "isMain",

      COALESCE((
        SELECT COUNT(*)::int
        FROM sales s
        WHERE s.location_id = l.id
          ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
          AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
      ), 0)::int as "salesCount",

      COALESCE((
        SELECT SUM(s.total_amount)::bigint
        FROM sales s
        WHERE s.location_id = l.id
          ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
          AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
      ), 0)::bigint as "salesTotal",

      COALESCE((
        SELECT COUNT(*)::int
        FROM payments p
        WHERE p.location_id = l.id
          ${fromTs ? sql`AND p.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND p.created_at < ${toExclusiveTs}` : sql``}
      ), 0)::int as "paymentsCount",

      COALESCE((
        SELECT SUM(p.amount)::bigint
        FROM payments p
        WHERE p.location_id = l.id
          ${fromTs ? sql`AND p.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND p.created_at < ${toExclusiveTs}` : sql``}
      ), 0)::bigint as "paymentsTotal",

      COALESCE((
        SELECT COUNT(*)::int
        FROM credits c
        WHERE c.location_id = l.id
          ${fromTs ? sql`AND c.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND c.created_at < ${toExclusiveTs}` : sql``}
      ), 0)::int as "creditsCount",

      COALESCE((
        SELECT SUM(c.remaining_amount)::bigint
        FROM credits c
        WHERE c.location_id = l.id
          AND c.status IN ('APPROVED', 'PARTIALLY_PAID')
      ), 0)::bigint as "creditsOutstandingTotal",

      COALESCE((
        SELECT COUNT(*)::int
        FROM refunds r
        WHERE r.location_id = l.id
          ${fromTs ? sql`AND r.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND r.created_at < ${toExclusiveTs}` : sql``}
      ), 0)::int as "refundsCount",

      COALESCE((
        SELECT SUM(r.total_amount)::bigint
        FROM refunds r
        WHERE r.location_id = l.id
          ${fromTs ? sql`AND r.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND r.created_at < ${toExclusiveTs}` : sql``}
      ), 0)::bigint as "refundsTotal",

      COALESCE((
        SELECT SUM(CASE WHEN cl.direction = 'IN' THEN cl.amount ELSE 0 END)::bigint
        FROM cash_ledger cl
        WHERE cl.location_id = l.id
          ${fromTs ? sql`AND cl.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND cl.created_at < ${toExclusiveTs}` : sql``}
      ), 0)::bigint as "cashInTotal",

      COALESCE((
        SELECT SUM(CASE WHEN cl.direction = 'OUT' THEN cl.amount ELSE 0 END)::bigint
        FROM cash_ledger cl
        WHERE cl.location_id = l.id
          ${fromTs ? sql`AND cl.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND cl.created_at < ${toExclusiveTs}` : sql``}
      ), 0)::bigint as "cashOutTotal"
    FROM locations l
    WHERE 1 = 1
      ${locationIdInt ? sql`AND l.id = ${locationIdInt}` : sql``}
    ORDER BY l.is_main DESC, l.name ASC
  `);

  return rowsOf(result);
}

async function getOwnerFinancialSummary(input = {}) {
  const { locationIdInt, fromTs, toExclusiveTs } = buildFilters(input);

  const salesByStatusRes = await db.execute(sql`
    SELECT
      UPPER(COALESCE(s.status::text, 'UNKNOWN')) as "status",
      COUNT(*)::int as "count",
      COALESCE(SUM(s.total_amount), 0)::bigint as "total"
    FROM sales s
    WHERE 1 = 1
      ${locationIdInt ? sql`AND s.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
    GROUP BY 1
    ORDER BY "total" DESC
  `);

  const paymentsByMethodRes = await db.execute(sql`
    SELECT
      UPPER(COALESCE(p.method::text, 'UNKNOWN')) as "method",
      COUNT(*)::int as "count",
      COALESCE(SUM(p.amount), 0)::bigint as "total"
    FROM payments p
    WHERE 1 = 1
      ${locationIdInt ? sql`AND p.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND p.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND p.created_at < ${toExclusiveTs}` : sql``}
    GROUP BY 1
    ORDER BY "total" DESC
  `);

  const creditsByStatusRes = await db.execute(sql`
    SELECT
      UPPER(COALESCE(c.status::text, 'UNKNOWN')) as "status",
      COUNT(*)::int as "count",
      COALESCE(SUM(c.principal_amount), 0)::bigint as "total",
      COALESCE(SUM(c.paid_amount), 0)::bigint as "paidTotal",
      COALESCE(SUM(c.remaining_amount), 0)::bigint as "remainingTotal"
    FROM credits c
    WHERE 1 = 1
      ${locationIdInt ? sql`AND c.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND c.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND c.created_at < ${toExclusiveTs}` : sql``}
    GROUP BY 1
    ORDER BY "total" DESC
  `);

  const refundsByMethodRes = await db.execute(sql`
    SELECT
      UPPER(COALESCE(r.method::text, 'UNKNOWN')) as "method",
      COUNT(*)::int as "count",
      COALESCE(SUM(r.total_amount), 0)::bigint as "total"
    FROM refunds r
    WHERE 1 = 1
      ${locationIdInt ? sql`AND r.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND r.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND r.created_at < ${toExclusiveTs}` : sql``}
    GROUP BY 1
    ORDER BY "total" DESC
  `);

  return {
    salesByStatus: rowsOf(salesByStatusRes),
    paymentsByMethod: rowsOf(paymentsByMethodRes),
    creditsByStatus: rowsOf(creditsByStatusRes),
    refundsByMethod: rowsOf(refundsByMethodRes),
  };
}

async function getOwnerCashFlowReport(input = {}) {
  const { locationIdInt, fromTs, toExclusiveTs } = buildFilters(input);

  const cashSalesPaymentsRes = await db.execute(sql`
    SELECT COALESCE(SUM(p.amount), 0)::bigint AS total
    FROM payments p
    WHERE 1 = 1
      ${locationIdInt ? sql`AND p.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND p.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND p.created_at < ${toExclusiveTs}` : sql``}
  `);

  const creditCollectionsRes = await db.execute(sql`
    SELECT COALESCE(SUM(cp.amount), 0)::bigint AS total
    FROM credit_payments cp
    WHERE 1 = 1
      ${locationIdInt ? sql`AND cp.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND cp.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND cp.created_at < ${toExclusiveTs}` : sql``}
  `);

  const ownerLoanRepaymentsRes = await db.execute(sql`
    SELECT COALESCE(SUM(olr.amount), 0)::bigint AS total
    FROM owner_loan_repayments olr
    WHERE 1 = 1
      ${locationIdInt ? sql`AND olr.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND olr.paid_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND olr.paid_at < ${toExclusiveTs}` : sql``}
  `);

  const supplierPaymentsRes = await db.execute(sql`
    SELECT COALESCE(SUM(sbp.amount), 0)::bigint AS total
    FROM supplier_bill_payments sbp
    JOIN supplier_bills sb ON sb.id = sbp.bill_id
    WHERE 1 = 1
      ${locationIdInt ? sql`AND sb.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND sbp.paid_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND sbp.paid_at < ${toExclusiveTs}` : sql``}
  `);

  const operatingExpensesRes = await db.execute(sql`
    SELECT COALESCE(SUM(e.amount), 0)::bigint AS total
    FROM expenses e
    WHERE 1 = 1
      ${locationIdInt ? sql`AND e.location_id = ${locationIdInt}` : sql``}
      AND UPPER(COALESCE(e.status::text, 'POSTED')) = 'POSTED'
      ${fromTs ? sql`AND e.expense_date >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND e.expense_date < ${toExclusiveTs}` : sql``}
  `);

  const refundOutflowsRes = await db.execute(sql`
    SELECT COALESCE(SUM(r.total_amount), 0)::bigint AS total
    FROM refunds r
    WHERE 1 = 1
      ${locationIdInt ? sql`AND r.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND r.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND r.created_at < ${toExclusiveTs}` : sql``}
  `);

  const ownerLoanDisbursementsRes = await db.execute(sql`
    SELECT COALESCE(SUM(ol.principal_amount), 0)::bigint AS total
    FROM owner_loans ol
    WHERE 1 = 1
      ${locationIdInt ? sql`AND ol.location_id = ${locationIdInt}` : sql``}
      AND UPPER(COALESCE(ol.status::text, 'OPEN')) <> 'VOID'
      ${fromTs ? sql`AND ol.disbursed_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND ol.disbursed_at < ${toExclusiveTs}` : sql``}
  `);

  const inflows = [
    {
      key: "salePayments",
      label: "Sale payments received",
      amount: toMoneyInt(firstRow(cashSalesPaymentsRes).total),
    },
    {
      key: "creditCollections",
      label: "Credit collections received",
      amount: toMoneyInt(firstRow(creditCollectionsRes).total),
    },
    {
      key: "ownerLoanRepayments",
      label: "Owner loan repayments received",
      amount: toMoneyInt(firstRow(ownerLoanRepaymentsRes).total),
    },
  ];

  const outflows = [
    {
      key: "supplierPayments",
      label: "Supplier bill payments",
      amount: toMoneyInt(firstRow(supplierPaymentsRes).total),
    },
    {
      key: "operatingExpenses",
      label: "Operating expenses",
      amount: toMoneyInt(firstRow(operatingExpensesRes).total),
    },
    {
      key: "refunds",
      label: "Refunds paid out",
      amount: toMoneyInt(firstRow(refundOutflowsRes).total),
    },
    {
      key: "ownerLoanDisbursements",
      label: "Owner loans disbursed",
      amount: toMoneyInt(firstRow(ownerLoanDisbursementsRes).total),
    },
  ];

  const totalInflows = inflows.reduce((sum, x) => sum + x.amount, 0);
  const totalOutflows = outflows.reduce((sum, x) => sum + x.amount, 0);

  return {
    meta: makeMeta({ locationIdInt, fromTs, toExclusiveTs }),
    inflows,
    outflows,
    totals: {
      totalInflows,
      totalOutflows,
      netCashFlow: totalInflows - totalOutflows,
    },
  };
}

async function getOwnerTrialBalanceReport(input = {}) {
  const { locationIdInt } = buildFilters(input);
  const { asOfDate, asOfTs } = buildAsOfDate(input);

  const warnings = [];
  warnings.push(
    "Inventory is valued using current products.cost_price because historical inventory valuation snapshots are not stored in the current schema.",
  );

  const cashRes = await db.execute(sql`
    SELECT COALESCE(SUM(CASE WHEN cl.direction = 'IN' THEN cl.amount ELSE -cl.amount END), 0)::bigint AS balance
    FROM cash_ledger cl
    WHERE 1 = 1
      ${locationIdInt ? sql`AND cl.location_id = ${locationIdInt}` : sql``}
      ${asOfTs ? sql`AND cl.created_at < ${asOfTs}` : sql``}
  `);

  const arCreditsRes = await db.execute(sql`
    SELECT COALESCE(SUM(c.remaining_amount), 0)::bigint AS balance
    FROM credits c
    WHERE 1 = 1
      ${locationIdInt ? sql`AND c.location_id = ${locationIdInt}` : sql``}
      ${asOfTs ? sql`AND c.created_at < ${asOfTs}` : sql``}
      AND c.status IN ('APPROVED', 'PARTIALLY_PAID')
  `);

  const ownerLoansReceivableRes = await db.execute(sql`
    SELECT COALESCE(SUM(ol.principal_amount - ol.repaid_amount), 0)::bigint AS balance
    FROM owner_loans ol
    WHERE 1 = 1
      ${locationIdInt ? sql`AND ol.location_id = ${locationIdInt}` : sql``}
      ${asOfTs ? sql`AND ol.disbursed_at < ${asOfTs}` : sql``}
      AND ol.status IN ('OPEN', 'PARTIALLY_REPAID')
  `);

  const inventoryAssetRes = await db.execute(sql`
    SELECT ROUND(COALESCE(SUM(COALESCE(ib.qty_on_hand, 0) * COALESCE(p.cost_price, 0)), 0))::bigint AS balance
    FROM products p
    LEFT JOIN inventory_balances ib
      ON ib.product_id = p.id AND ib.location_id = p.location_id
    WHERE 1 = 1
      ${locationIdInt ? sql`AND p.location_id = ${locationIdInt}` : sql``}
      AND COALESCE(p.is_active, true) = true
  `);

  const supplierPayablesRes = await db.execute(sql`
    SELECT COALESCE(SUM(sb.total_amount - sb.paid_amount), 0)::bigint AS balance
    FROM supplier_bills sb
    WHERE 1 = 1
      ${locationIdInt ? sql`AND sb.location_id = ${locationIdInt}` : sql``}
      ${asOfTs ? sql`AND sb.created_at < ${asOfTs}` : sql``}
      AND UPPER(COALESCE(sb.status::text, 'OPEN')) <> 'VOID'
      AND (sb.total_amount - sb.paid_amount) > 0
  `);

  const recognizedSalesRevenueRes = await db.execute(sql`
    SELECT COALESCE(SUM(s.total_amount), 0)::bigint AS balance
    FROM sales s
    WHERE 1 = 1
      ${locationIdInt ? sql`AND s.location_id = ${locationIdInt}` : sql``}
      ${asOfTs ? sql`AND s.created_at < ${asOfTs}` : sql``}
      AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
  `);

  const refundsContraRevenueRes = await db.execute(sql`
    SELECT COALESCE(SUM(r.total_amount), 0)::bigint AS balance
    FROM refunds r
    WHERE 1 = 1
      ${locationIdInt ? sql`AND r.location_id = ${locationIdInt}` : sql``}
      ${asOfTs ? sql`AND r.created_at < ${asOfTs}` : sql``}
  `);

  const estimatedCogsRes = await db.execute(sql`
    SELECT COALESCE(SUM(si.qty * COALESCE(p.cost_price, 0)), 0)::bigint AS balance
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id AND p.location_id = s.location_id
    WHERE 1 = 1
      ${locationIdInt ? sql`AND s.location_id = ${locationIdInt}` : sql``}
      ${asOfTs ? sql`AND s.created_at < ${asOfTs}` : sql``}
      AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
  `);

  const operatingExpensesRes = await db.execute(sql`
    SELECT COALESCE(SUM(e.amount), 0)::bigint AS balance
    FROM expenses e
    WHERE 1 = 1
      ${locationIdInt ? sql`AND e.location_id = ${locationIdInt}` : sql``}
      ${asOfTs ? sql`AND e.expense_date < ${asOfTs}` : sql``}
      AND UPPER(COALESCE(e.status::text, 'POSTED')) = 'POSTED'
  `);

  const accounts = [
    {
      code: "1010",
      name: "Cash and cash equivalents",
      type: "ASSET",
      normalSide: "DEBIT",
      amount: toMoneyInt(firstRow(cashRes).balance),
    },
    {
      code: "1100",
      name: "Accounts receivable - customer credits",
      type: "ASSET",
      normalSide: "DEBIT",
      amount: toMoneyInt(firstRow(arCreditsRes).balance),
    },
    {
      code: "1150",
      name: "Loans receivable",
      type: "ASSET",
      normalSide: "DEBIT",
      amount: toMoneyInt(firstRow(ownerLoansReceivableRes).balance),
    },
    {
      code: "1200",
      name: "Inventory asset",
      type: "ASSET",
      normalSide: "DEBIT",
      amount: toMoneyInt(firstRow(inventoryAssetRes).balance),
    },
    {
      code: "2000",
      name: "Accounts payable - suppliers",
      type: "LIABILITY",
      normalSide: "CREDIT",
      amount: toMoneyInt(firstRow(supplierPayablesRes).balance),
    },
    {
      code: "4000",
      name: "Sales revenue",
      type: "REVENUE",
      normalSide: "CREDIT",
      amount: toMoneyInt(firstRow(recognizedSalesRevenueRes).balance),
    },
    {
      code: "4010",
      name: "Sales refunds / contra revenue",
      type: "CONTRA_REVENUE",
      normalSide: "DEBIT",
      amount: toMoneyInt(firstRow(refundsContraRevenueRes).balance),
    },
    {
      code: "5000",
      name: "Cost of goods sold (estimated)",
      type: "EXPENSE",
      normalSide: "DEBIT",
      amount: toMoneyInt(firstRow(estimatedCogsRes).balance),
    },
    {
      code: "6100",
      name: "Operating expenses",
      type: "EXPENSE",
      normalSide: "DEBIT",
      amount: toMoneyInt(firstRow(operatingExpensesRes).balance),
    },
  ];

  const rows = accounts
    .filter((x) => x.amount !== 0)
    .map((account) => {
      const debit = account.normalSide === "DEBIT" ? account.amount : 0;
      const credit = account.normalSide === "CREDIT" ? account.amount : 0;
      return {
        ...account,
        debit,
        credit,
      };
    });

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalDebits += row.debit;
      acc.totalCredits += row.credit;
      return acc;
    },
    { totalDebits: 0, totalCredits: 0 },
  );

  return {
    meta: makeMeta({
      locationIdInt,
      asOfDate: asOfDate || null,
      warnings,
    }),
    rows,
    totals: {
      ...totals,
      isBalanced: totals.totalDebits === totals.totalCredits,
      difference: totals.totalDebits - totals.totalCredits,
    },
  };
}

async function getOwnerIncomeStatementReport(input = {}) {
  const { locationIdInt, fromTs, toExclusiveTs } = buildFilters(input);

  const warnings = [];
  warnings.push(
    "Cost of goods sold is estimated from current products.cost_price because historical item cost snapshots are not stored on sale_items.",
  );

  const revenueRes = await db.execute(sql`
    SELECT COALESCE(SUM(s.total_amount), 0)::bigint AS total
    FROM sales s
    WHERE 1 = 1
      ${locationIdInt ? sql`AND s.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
      AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
  `);

  const refundsRes = await db.execute(sql`
    SELECT COALESCE(SUM(r.total_amount), 0)::bigint AS total
    FROM refunds r
    WHERE 1 = 1
      ${locationIdInt ? sql`AND r.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND r.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND r.created_at < ${toExclusiveTs}` : sql``}
  `);

  const extraChargeRevenueRes = await db.execute(sql`
    SELECT COALESCE(SUM(si.qty * COALESCE(si.extra_charge_per_unit, 0)), 0)::bigint AS total
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE 1 = 1
      ${locationIdInt ? sql`AND s.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
      AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
  `);

  const cogsRes = await db.execute(sql`
    SELECT COALESCE(SUM(si.qty * COALESCE(p.cost_price, 0)), 0)::bigint AS total
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id AND p.location_id = s.location_id
    WHERE 1 = 1
      ${locationIdInt ? sql`AND s.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
      AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
  `);

  const operatingExpensesRes = await db.execute(sql`
    SELECT COALESCE(SUM(e.amount), 0)::bigint AS total
    FROM expenses e
    WHERE 1 = 1
      ${locationIdInt ? sql`AND e.location_id = ${locationIdInt}` : sql``}
      ${fromTs ? sql`AND e.expense_date >= ${fromTs}` : sql``}
      ${toExclusiveTs ? sql`AND e.expense_date < ${toExclusiveTs}` : sql``}
      AND UPPER(COALESCE(e.status::text, 'POSTED')) = 'POSTED'
  `);

  const revenue = toMoneyInt(firstRow(revenueRes).total);
  const refunds = toMoneyInt(firstRow(refundsRes).total);
  const extraChargeRevenue = toMoneyInt(firstRow(extraChargeRevenueRes).total);
  const cogs = toMoneyInt(firstRow(cogsRes).total);
  const operatingExpenses = toMoneyInt(firstRow(operatingExpensesRes).total);

  const netRevenue = revenue - refunds;
  const grossProfit = netRevenue - cogs;
  const operatingProfit = grossProfit - operatingExpenses;

  return {
    meta: makeMeta({ locationIdInt, fromTs, toExclusiveTs, warnings }),
    revenue: {
      grossSales: revenue,
      refunds,
      netRevenue,
      extraChargeRevenue,
    },
    costOfSales: {
      estimatedCogs: cogs,
    },
    profitability: {
      grossProfit,
      grossMarginPct: toPct(grossProfit, netRevenue),
    },
    operatingExpenses: {
      total: operatingExpenses,
    },
    bottomLine: {
      operatingProfit,
      operatingMarginPct: toPct(operatingProfit, netRevenue),
    },
  };
}

async function getOwnerProfitTableReport(input = {}) {
  const { locationIdInt, fromTs, toExclusiveTs } = buildFilters(input);

  const warnings = [];
  warnings.push(
    "Profit rows use current products.cost_price for COGS estimation because historical item cost snapshots are not stored per sale line.",
  );

  const result = await db.execute(sql`
    SELECT
      l.id::int AS "locationId",
      l.name AS "locationName",
      l.code AS "locationCode",
      l.is_main AS "isMain",

      COALESCE((
        SELECT SUM(s.total_amount)::bigint
        FROM sales s
        WHERE s.location_id = l.id
          ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
          AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
      ), 0)::bigint AS "grossSales",

      COALESCE((
        SELECT SUM(r.total_amount)::bigint
        FROM refunds r
        WHERE r.location_id = l.id
          ${fromTs ? sql`AND r.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND r.created_at < ${toExclusiveTs}` : sql``}
      ), 0)::bigint AS "refunds",

      COALESCE((
        SELECT SUM(si.qty * COALESCE(si.extra_charge_per_unit, 0))::bigint
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.location_id = l.id
          ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
          AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
      ), 0)::bigint AS "extraChargeRevenue",

      COALESCE((
        SELECT SUM(si.qty * COALESCE(p.cost_price, 0))::bigint
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id AND p.location_id = s.location_id
        WHERE s.location_id = l.id
          ${fromTs ? sql`AND s.created_at >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND s.created_at < ${toExclusiveTs}` : sql``}
          AND UPPER(COALESCE(s.status::text, 'DRAFT')) IN ('FULFILLED', 'COMPLETED')
      ), 0)::bigint AS "estimatedCogs",

      COALESCE((
        SELECT SUM(e.amount)::bigint
        FROM expenses e
        WHERE e.location_id = l.id
          ${fromTs ? sql`AND e.expense_date >= ${fromTs}` : sql``}
          ${toExclusiveTs ? sql`AND e.expense_date < ${toExclusiveTs}` : sql``}
          AND UPPER(COALESCE(e.status::text, 'POSTED')) = 'POSTED'
      ), 0)::bigint AS "operatingExpenses"
    FROM locations l
    WHERE 1 = 1
      ${locationIdInt ? sql`AND l.id = ${locationIdInt}` : sql``}
    ORDER BY l.is_main DESC, l.name ASC
  `);

  const rows = rowsOf(result).map((row) => {
    const grossSales = toMoneyInt(row.grossSales);
    const refunds = toMoneyInt(row.refunds);
    const netRevenue = grossSales - refunds;
    const estimatedCogs = toMoneyInt(row.estimatedCogs);
    const grossProfit = netRevenue - estimatedCogs;
    const operatingExpenses = toMoneyInt(row.operatingExpenses);
    const operatingProfit = grossProfit - operatingExpenses;

    return {
      locationId: toInt(row.locationId, 0),
      locationName: row.locationName || "—",
      locationCode: row.locationCode || "—",
      isMain: Boolean(row.isMain),
      grossSales,
      refunds,
      netRevenue,
      extraChargeRevenue: toMoneyInt(row.extraChargeRevenue),
      estimatedCogs,
      grossProfit,
      grossMarginPct: toPct(grossProfit, netRevenue),
      operatingExpenses,
      operatingProfit,
      operatingMarginPct: toPct(operatingProfit, netRevenue),
    };
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.grossSales += row.grossSales;
      acc.refunds += row.refunds;
      acc.netRevenue += row.netRevenue;
      acc.extraChargeRevenue += row.extraChargeRevenue;
      acc.estimatedCogs += row.estimatedCogs;
      acc.grossProfit += row.grossProfit;
      acc.operatingExpenses += row.operatingExpenses;
      acc.operatingProfit += row.operatingProfit;
      return acc;
    },
    {
      grossSales: 0,
      refunds: 0,
      netRevenue: 0,
      extraChargeRevenue: 0,
      estimatedCogs: 0,
      grossProfit: 0,
      operatingExpenses: 0,
      operatingProfit: 0,
    },
  );

  totals.grossMarginPct = toPct(totals.grossProfit, totals.netRevenue);
  totals.operatingMarginPct = toPct(totals.operatingProfit, totals.netRevenue);

  return {
    meta: makeMeta({ locationIdInt, fromTs, toExclusiveTs, warnings }),
    rows,
    totals,
  };
}

module.exports = {
  getOwnerReportsOverview,
  getOwnerBranchPerformance,
  getOwnerFinancialSummary,
  getOwnerCashFlowReport,
  getOwnerTrialBalanceReport,
  getOwnerIncomeStatementReport,
  getOwnerProfitTableReport,
};
