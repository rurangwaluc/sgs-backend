const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");

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
  app.get(
    "/owner/reports/overview",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    getOwnerReportsOverview,
  );

  app.get(
    "/owner/reports/branch-performance",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    getOwnerBranchPerformance,
  );

  app.get(
    "/owner/reports/financial-summary",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    getOwnerFinancialSummary,
  );

  app.get(
    "/owner/reports/cash-flow",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    getOwnerCashFlowReport,
  );

  app.get(
    "/owner/reports/trial-balance",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    getOwnerTrialBalanceReport,
  );

  app.get(
    "/owner/reports/income-statement",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    getOwnerIncomeStatementReport,
  );

  app.get(
    "/owner/reports/profit-table",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    getOwnerProfitTableReport,
  );

  // defensive alias in case frontend/request uses the earlier typo
  app.get(
    "/owner/reports/profile-table",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    getOwnerProfitTableReport,
  );
}

module.exports = { ownerReportsRoutes };
