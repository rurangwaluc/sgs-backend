const ACTIONS = require("../permissions/actions");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/requirePermission");

const {
  getOwnerCashSummary,
  listOwnerCashLedger,
  listOwnerCashSessions,
  listOwnerCashRefunds,
} = require("../controllers/ownerCashController");

async function ownerCashRoutes(app) {
  app.get(
    "/owner/cash/summary",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.CASH_REPORT_VIEW]),
      ],
    },
    getOwnerCashSummary,
  );

  app.get(
    "/owner/cash/ledger",
    {
      preHandler: [
        requireAnyPermission([
          ACTIONS.OWNER_ONLY,
          ACTIONS.CASH_REPORT_VIEW,
          ACTIONS.CASH_LEDGER_VIEW,
        ]),
      ],
    },
    listOwnerCashLedger,
  );

  app.get(
    "/owner/cash/sessions",
    {
      preHandler: [
        requireAnyPermission([
          ACTIONS.OWNER_ONLY,
          ACTIONS.CASH_REPORT_VIEW,
          ACTIONS.CASH_SESSION_VIEW,
        ]),
      ],
    },
    listOwnerCashSessions,
  );

  app.get(
    "/owner/cash/refunds",
    {
      preHandler: [
        requireAnyPermission([
          ACTIONS.OWNER_ONLY,
          ACTIONS.CASH_REPORT_VIEW,
          ACTIONS.REFUND_VIEW,
        ]),
      ],
    },
    listOwnerCashRefunds,
  );
}

module.exports = { ownerCashRoutes };
