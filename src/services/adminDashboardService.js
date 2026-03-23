// backend/src/services/adminDashboardService.js
const { db } = require("../config/db");
const { sql } = require("drizzle-orm");

function rowsOf(r) {
  return r?.rows || r || [];
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function getAdminDashboard({ locationId }) {
  const parsedLocationId = Number(locationId);
  if (!Number.isFinite(parsedLocationId) || parsedLocationId <= 0) {
    const err = new Error("Invalid locationId");
    err.code = "INVALID_LOCATION_ID";
    throw err;
  }

  const todayStart = sql`date_trunc('day', now())`;
  const yesterdayStart = sql`date_trunc('day', now()) - interval '1 day'`;

  // 1) Sales KPIs
  const salesToday = rowsOf(
    await db.execute(sql`
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(total_amount), 0)::bigint AS total
        FROM sales
        WHERE location_id = ${parsedLocationId}
          AND created_at >= ${todayStart}
      `),
  )[0] || { count: 0, total: 0 };

  const awaitingPayment = rowsOf(
    await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM sales
        WHERE location_id = ${parsedLocationId}
          AND status = 'AWAITING_PAYMENT_RECORD'
      `),
  )[0] || { count: 0 };

  const draftSales = rowsOf(
    await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM sales
        WHERE location_id = ${parsedLocationId}
          AND status = 'DRAFT'
      `),
  )[0] || { count: 0 };

  const completedToday = rowsOf(
    await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM sales
        WHERE location_id = ${parsedLocationId}
          AND status = 'COMPLETED'
          AND created_at >= ${todayStart}
      `),
  )[0] || { count: 0 };

  // 2) Stuck sales
  const stuck = rowsOf(
    await db.execute(sql`
      SELECT
        id,
        status,
        total_amount AS "totalAmount",
        created_at AS "createdAt",
        EXTRACT(EPOCH FROM (now() - created_at))::int AS "ageSeconds"
      FROM sales
      WHERE location_id = ${parsedLocationId}
        AND status NOT IN ('COMPLETED', 'CANCELLED', 'REFUNDED')
        AND created_at < (now() - interval '30 minutes')
      ORDER BY created_at ASC
      LIMIT 20
    `),
  ).map((s) => ({
    ...s,
    totalAmount: toInt(s.totalAmount),
    ageSeconds: toInt(s.ageSeconds),
  }));

  // 3) Payments summary
  const paymentsToday = rowsOf(
    await db.execute(sql`
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(amount), 0)::bigint AS total
        FROM payments
        WHERE location_id = ${parsedLocationId}
          AND created_at >= ${todayStart}
      `),
  )[0] || { count: 0, total: 0 };

  const paymentsYesterday = rowsOf(
    await db.execute(sql`
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(amount), 0)::bigint AS total
        FROM payments
        WHERE location_id = ${parsedLocationId}
          AND created_at >= ${yesterdayStart}
          AND created_at < ${todayStart}
      `),
  )[0] || { count: 0, total: 0 };

  const paymentsAll = rowsOf(
    await db.execute(sql`
        SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(amount), 0)::bigint AS total
        FROM payments
        WHERE location_id = ${parsedLocationId}
      `),
  )[0] || { count: 0, total: 0 };

  // 4) Payment breakdown (today)
  const breakdownToday = rowsOf(
    await db.execute(sql`
      SELECT
        UPPER(COALESCE(method::text, 'OTHER')) AS method,
        COUNT(*)::int AS count,
        COALESCE(SUM(amount), 0)::bigint AS total
      FROM payments
      WHERE location_id = ${parsedLocationId}
        AND created_at >= ${todayStart}
      GROUP BY 1
      ORDER BY total DESC
    `),
  ).map((r) => ({
    method: r.method,
    count: toInt(r.count),
    total: toInt(r.total),
  }));

  // 5) Last 10 payments
  const last10 = rowsOf(
    await db.execute(sql`
      SELECT
        id,
        sale_id AS "saleId",
        amount,
        method,
        created_at AS "createdAt"
      FROM payments
      WHERE location_id = ${parsedLocationId}
      ORDER BY created_at DESC
      LIMIT 10
    `),
  ).map((p) => ({
    id: p.id,
    saleId: p.saleId,
    amount: toInt(p.amount),
    method: p.method || "OTHER",
    createdAt: p.createdAt,
  }));

  // 6) Low stock
  const lowStockThreshold = 5;

  const lowStock = rowsOf(
    await db.execute(sql`
      SELECT
        product_id AS "productId",
        COALESCE(qty_on_hand, 0)::int AS "qtyOnHand"
      FROM inventory_balances
      WHERE location_id = ${parsedLocationId}
        AND COALESCE(qty_on_hand, 0) <= ${lowStockThreshold}
      ORDER BY qty_on_hand ASC
      LIMIT 15
    `),
  ).map((r) => ({
    productId: r.productId,
    qtyOnHand: toInt(r.qtyOnHand),
  }));

  // 7) Admin branch inventory totals
  const inventorySummary = rowsOf(
    await db.execute(sql`
        SELECT
          ${parsedLocationId}::int AS "locationId",
          COALESCE(SUM(COALESCE(b.qty_on_hand, 0)), 0)::bigint AS "totalQtyOnHand",
          COALESCE(
            SUM(COALESCE(b.qty_on_hand, 0) * COALESCE(p.cost_price, 0)),
            0
          )::bigint AS "inventoryValue",
          COUNT(DISTINCT p.id)::int AS "productsCount",
          COUNT(*) FILTER (
            WHERE COALESCE(b.qty_on_hand, 0) > 0
              AND COALESCE(b.qty_on_hand, 0) <= ${lowStockThreshold}
          )::int AS "lowStockCount",
          COUNT(*) FILTER (
            WHERE COALESCE(b.qty_on_hand, 0) <= 0
          )::int AS "outOfStockCount"
        FROM products p
        LEFT JOIN inventory_balances b
          ON b.product_id = p.id
         AND b.location_id = p.location_id
        WHERE p.location_id = ${parsedLocationId}
          AND COALESCE(p.is_active, true) = true
      `),
  )[0] || {
    locationId: parsedLocationId,
    totalQtyOnHand: 0,
    inventoryValue: 0,
    productsCount: 0,
    lowStockCount: 0,
    outOfStockCount: 0,
  };

  return {
    sales: {
      today: {
        count: toInt(salesToday.count),
        total: toInt(salesToday.total),
      },
      awaitingPayment: toInt(awaitingPayment.count),
      draft: toInt(draftSales.count),
      completedToday: toInt(completedToday.count),
      stuck,
      stuckRule: "Not COMPLETED/CANCELLED/REFUNDED and older than 30 minutes",
    },
    payments: {
      today: {
        count: toInt(paymentsToday.count),
        total: toInt(paymentsToday.total),
      },
      yesterday: {
        count: toInt(paymentsYesterday.count),
        total: toInt(paymentsYesterday.total),
      },
      allTime: {
        count: toInt(paymentsAll.count),
        total: toInt(paymentsAll.total),
      },
      breakdownToday,
      last10,
    },
    inventory: {
      lowStock,
      lowStockThreshold,
      locationId: toInt(inventorySummary.locationId),
      totalQtyOnHand: toInt(inventorySummary.totalQtyOnHand),
      inventoryValue: toInt(inventorySummary.inventoryValue),
      productsCount: toInt(inventorySummary.productsCount),
      lowStockCount: toInt(inventorySummary.lowStockCount),
      outOfStockCount: toInt(inventorySummary.outOfStockCount),
    },
  };
}

module.exports = { getAdminDashboard };
