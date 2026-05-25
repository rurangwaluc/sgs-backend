const ACTIONS = require("../permissions/actions");
const { requireAnyPermission } = require("../middleware/requirePermission");

const {
  getOwnerReportsOverview,
  getOwnerBranchPerformance,
  getOwnerFinancialSummary,
  getOwnerCashFlowReport,
  getOwnerTrialBalanceReport,
  getOwnerIncomeStatementReport,
  getOwnerProfitTableReport,
} = require("../controllers/ownerReportsController");

async function ownerReportsRoutes(app) {
  const ownerOrReports = requireAnyPermission([
    ACTIONS.OWNER_ONLY,
    ACTIONS.REPORT_VIEW,
  ]);

  app.get(
    "/owner/reports/overview",
    { preHandler: [ownerOrReports] },
    getOwnerReportsOverview,
  );

  app.get(
    "/owner/reports/branch-performance",
    { preHandler: [ownerOrReports] },
    getOwnerBranchPerformance,
  );

  app.get(
    "/owner/reports/financial-summary",
    { preHandler: [ownerOrReports] },
    getOwnerFinancialSummary,
  );

  app.get(
    "/owner/reports/cash-flow",
    { preHandler: [ownerOrReports] },
    getOwnerCashFlowReport,
  );

  app.get(
    "/owner/reports/trial-balance",
    { preHandler: [ownerOrReports] },
    getOwnerTrialBalanceReport,
  );

  app.get(
    "/owner/reports/income-statement",
    { preHandler: [ownerOrReports] },
    getOwnerIncomeStatementReport,
  );

  app.get(
    "/owner/reports/profit-table",
    { preHandler: [ownerOrReports] },
    getOwnerProfitTableReport,
  );

  app.get(
    "/owner/reports/profile-table",
    { preHandler: [ownerOrReports] },
    getOwnerProfitTableReport,
  );
}

module.exports = { ownerReportsRoutes };
