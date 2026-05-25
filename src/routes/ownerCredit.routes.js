const ACTIONS = require("../permissions/actions");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/requirePermission");

const {
  getOwnerCreditsSummary,
  listOwnerCredits,
  getOwnerCredit,
  ownerDecideCredit,
  ownerSettleCredit,
} = require("../controllers/ownerCreditController");

async function ownerCreditRoutes(app) {
  app.get(
    "/owner/credits/summary",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.CREDIT_VIEW]),
      ],
    },
    getOwnerCreditsSummary,
  );

  app.get(
    "/owner/credits",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.CREDIT_VIEW]),
      ],
    },
    listOwnerCredits,
  );

  app.get(
    "/owner/credits/:id",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.CREDIT_VIEW]),
      ],
    },
    getOwnerCredit,
  );

  app.patch(
    "/owner/credits/:id/decision",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.CREDIT_DECIDE]),
      ],
    },
    ownerDecideCredit,
  );

  app.patch(
    "/owner/credits/:id/settle",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.CREDIT_SETTLE]),
      ],
    },
    ownerSettleCredit,
  );
}

module.exports = { ownerCreditRoutes };
