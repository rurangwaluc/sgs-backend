"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");

const {
  listOwnerLoans,
  getOwnerLoan,
  createOwnerLoan,
  updateOwnerLoan,
  createOwnerLoanRepayment,
  voidOwnerLoan,
  ownerLoanSummary,
} = require("../controllers/ownerLoansController");

function ownerLoansRoutes(app, _opts, done) {
  app.get(
    "/owner-loans/summary",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_LOAN_SUMMARY_VIEW)],
    },
    ownerLoanSummary,
  );

  app.get(
    "/owner-loans",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_LOAN_VIEW)],
    },
    listOwnerLoans,
  );

  app.get(
    "/owner-loans/:id",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_LOAN_VIEW)],
    },
    getOwnerLoan,
  );

  app.post(
    "/owner-loans",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_LOAN_CREATE)],
    },
    createOwnerLoan,
  );

  app.patch(
    "/owner-loans/:id",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_LOAN_UPDATE)],
    },
    updateOwnerLoan,
  );

  app.post(
    "/owner-loans/:id/repayments",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_LOAN_REPAYMENT_CREATE)],
    },
    createOwnerLoanRepayment,
  );

  app.post(
    "/owner-loans/:id/void",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_LOAN_VOID)],
    },
    voidOwnerLoan,
  );

  done();
}

module.exports = { ownerLoansRoutes };
