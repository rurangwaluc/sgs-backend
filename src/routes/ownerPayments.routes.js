"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");
const {
  listOwnerPayments,
  getOwnerPaymentsSummary,
  getOwnerPaymentsBreakdown,
  listOwnerLoans,
  voidOwnerLoan,
} = require("../controllers/ownerPaymentsController");

async function ownerPaymentsRoutes(app) {
  app.get(
    "/owner/payments",
    { preHandler: [requirePermission(ACTIONS.OWNER_PAYMENTS_VIEW)] },
    listOwnerPayments,
  );

  app.get(
    "/owner/payments/summary",
    { preHandler: [requirePermission(ACTIONS.OWNER_PAYMENTS_VIEW)] },
    getOwnerPaymentsSummary,
  );

  app.get(
    "/owner/payments/breakdown",
    { preHandler: [requirePermission(ACTIONS.OWNER_PAYMENTS_VIEW)] },
    getOwnerPaymentsBreakdown,
  );

  app.get(
    "/owner/payments/owner-loans",
    { preHandler: [requirePermission(ACTIONS.OWNER_PAYMENTS_VIEW)] },
    listOwnerLoans,
  );

  app.post(
    "/owner/payments/owner-loans/:id/void",
    { preHandler: [requirePermission(ACTIONS.OWNER_PAYMENTS_VIEW)] },
    voidOwnerLoan,
  );
}

module.exports = { ownerPaymentsRoutes };
