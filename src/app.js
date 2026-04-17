"use strict";

const path = require("path");
const fastify = require("fastify");
const rateLimit = require("@fastify/rate-limit");
const cors = require("@fastify/cors");
const cookie = require("@fastify/cookie");
const multipart = require("@fastify/multipart");
const fastifyStatic = require("@fastify/static");

const { env } = require("./config/env");
const { sessionAuth } = require("./middleware/sessionAuth");

// Routes
const { bootstrapRoutes } = require("./routes/bootstrap.routes");
const { authRoutes } = require("./routes/auth.routes");
const { dashboardRoutes } = require("./routes/dashboard.routes");
const { ownerDashboardRoutes } = require("./routes/dashboard.owner.routes");
const { ownerRoutes } = require("./routes/owner.routes");
const { ownerInventoryRoutes } = require("./routes/ownerInventory.routes");
const { ownerProductsRoutes } = require("./routes/ownerProducts.routes");
const { ownerSalesRoutes } = require("./routes/ownerSales.routes");
const { ownerPaymentsRoutes } = require("./routes/ownerPayments.routes");
const { ownerCreditRoutes } = require("./routes/ownerCredit.routes");
const { ownerCashRoutes } = require("./routes/ownerCash.routes");
const { ownerReportsRoutes } = require("./routes/ownerReports.routes");
const { ownerSuppliersRoutes } = require("./routes/ownerSuppliers.routes");
const {
  ownerSupplierBillsRoutes,
} = require("./routes/ownerSupplierBills.routes");
const {
  ownerSupplierBillsWriteRoutes,
} = require("./routes/ownerSupplierBillsWrite.routes");
const {
  ownerSuppliersWriteRoutes,
} = require("./routes/ownerSuppliersWrite.routes");
const { ownerLoansRoutes } = require("./routes/ownerLoans.routes");

const { goodsReceiptsRoutes } = require("./routes/goodsReceipts.routes");
const { purchaseOrdersRoutes } = require("./routes/purchaseorders.routes");

const { proformasRoutes } = require("./routes/proformas.routes");
const { deliveryNotesRoutes } = require("./routes/deliveryNotes.routes");

const { usersRoutes } = require("./routes/users.routes");
const { customersRoutes } = require("./routes/customers.routes");
const { notesRoutes } = require("./routes/notes.routes");
const { auditRoutes } = require("./routes/audit.routes");

const { inventoryRoutes } = require("./routes/inventory.routes");
const {
  inventoryArrivalRoutes,
} = require("./routes/inventory.arrivals.routes");
const {
  inventoryAdjustRequestsRoutes,
} = require("./routes/inventoryAdjustRequests.routes");

const { notificationsRoutes } = require("./routes/notifications.routes");

const { managerDashboardRoutes } = require("./routes/manager.dashboard.routes");
const { adminDashboardRoutes } = require("./routes/adminDashboardRoutes");

const { productPricingRoutes } = require("./routes/productPricing.routes");
const { holdingsRoutes } = require("./routes/holdings.routes");
const { requestsRoutes } = require("./routes/requests.routes");

const { salesRoutes } = require("./routes/sales.routes");
const { salesReadRoutes } = require("./routes/sales.read.routes");
const { refundsRoutes } = require("./routes/refunds.routes");

const { paymentsRoutes } = require("./routes/payments.routes");
const { paymentsReadRoutes } = require("./routes/payments.read.routes");

const { cashRoutes } = require("./routes/cash.routes");
const { cashSessionsRoutes } = require("./routes/cashSessions.routes");
const { cashbookRoutes } = require("./routes/cashbook.routes");
const { expensesRoutes } = require("./routes/expenses.routes");
const { cashReconcileRoutes } = require("./routes/cashReconcile.routes");

const { creditRoutes } = require("./routes/credit.routes");
const { creditReadRoutes } = require("./routes/credit.read.routes");

const { reportsRoutes } = require("./routes/reports.routes");
const { uploadsRoutes } = require("./routes/uploads.routes");

// Suppliers
const { suppliersRoutes } = require("./routes/suppliers.routes");
const { supplierBillsRoutes } = require("./routes/supplierBills.routes");

const supplierProfilesRoutesModule = require("./routes/supplierProfiles.routes");
const supplierEvaluationsRoutesModule = require("./routes/supplierEvaluations.routes");

const supplierProfilesRoutes =
  supplierProfilesRoutesModule?.supplierProfilesRoutes ||
  supplierProfilesRoutesModule;

const supplierEvaluationsRoutes =
  supplierEvaluationsRoutesModule?.supplierEvaluationsRoutes ||
  supplierEvaluationsRoutesModule;

const { adminCoverageRoutes } = require("./routes/adminCoverage.routes");
const {
  purchaseOrdersPdfRoutes,
} = require("./routes/purchaseOrdersPdf.routes");

function normalizeOrigin(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

function buildApp() {
  const app = fastify({
    logger: true,
    trustProxy: true,
  });

  const { db } = require("./config/db");
  const { sql } = require("drizzle-orm");

  db.execute(sql`select current_database() as db, current_schema() as schema`)
    .then((r) => {
      const rows = r.rows || r;
      console.log("[DB CHECK]", rows?.[0]);
    })
    .catch((e) => console.error("[DB CHECK FAILED]", e));

  const allowList = new Set(
    (Array.isArray(env.CORS_ORIGINS) ? env.CORS_ORIGINS : [])
      .map(normalizeOrigin)
      .filter(Boolean),
  );

  app.register(cors, {
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Bootstrap-Secret",
      "X-Requested-With",
    ],
    exposedHeaders: ["Content-Disposition", "Content-Length", "Content-Type"],
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);

      const normalized = normalizeOrigin(origin);
      if (allowList.has(normalized)) {
        return cb(null, true);
      }

      cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
  });

  app.register(cookie, {
    secret: env.SESSION_SECRET,
    hook: "onRequest",
  });

  app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  });

  app.register(rateLimit, { global: false });

  app.register(fastifyStatic, {
    root: path.join(process.cwd(), "public"),
    prefix: "/public/",
    decorateReply: false,
  });

  app.addHook("preHandler", sessionAuth);

  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }));

  app.register(bootstrapRoutes);

  app.register(authRoutes);
  app.register(dashboardRoutes);
  app.register(ownerDashboardRoutes);
  app.register(ownerRoutes);
  app.register(ownerInventoryRoutes);
  app.register(ownerProductsRoutes);
  app.register(ownerSalesRoutes);
  app.register(ownerPaymentsRoutes);
  app.register(ownerCreditRoutes);
  app.register(ownerCashRoutes);
  app.register(ownerReportsRoutes);
  app.register(ownerSuppliersRoutes);
  app.register(ownerSupplierBillsRoutes);
  app.register(ownerSupplierBillsWriteRoutes);
  app.register(ownerSuppliersWriteRoutes);
  app.register(ownerLoansRoutes);

  app.register(goodsReceiptsRoutes);
  app.register(purchaseOrdersRoutes);
  app.register(purchaseOrdersPdfRoutes);

  app.register(proformasRoutes);
  app.register(deliveryNotesRoutes);

  app.register(managerDashboardRoutes);
  app.register(adminDashboardRoutes);

  app.register(notificationsRoutes);

  app.register(usersRoutes);
  app.register(customersRoutes);
  app.register(notesRoutes);
  app.register(auditRoutes);

  app.register(inventoryRoutes);
  app.register(inventoryArrivalRoutes);
  app.register(inventoryAdjustRequestsRoutes);
  app.register(productPricingRoutes);
  app.register(holdingsRoutes);
  app.register(requestsRoutes);

  app.register(salesRoutes);
  app.register(salesReadRoutes);
  app.register(refundsRoutes);
  app.register(paymentsRoutes);
  app.register(paymentsReadRoutes);

  app.register(cashRoutes);
  app.register(cashSessionsRoutes, { prefix: "/cash-sessions" });
  app.register(cashbookRoutes, { prefix: "/cashbook" });
  app.register(expensesRoutes);
  app.register(cashReconcileRoutes, { prefix: "/" });

  app.register(creditRoutes);
  app.register(creditReadRoutes);

  app.register(reportsRoutes);
  app.register(uploadsRoutes);

  app.register(suppliersRoutes);
  app.register(supplierBillsRoutes);

  if (typeof supplierProfilesRoutes === "function") {
    app.register(supplierProfilesRoutes);
  }

  if (typeof supplierEvaluationsRoutes === "function") {
    app.register(supplierEvaluationsRoutes);
  }

  app.register(adminCoverageRoutes);

  return app;
}

module.exports = { buildApp };
