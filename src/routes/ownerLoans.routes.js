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
      preHandler: [
        requirePermission(
          ACTIONS.OWNER_LOAN_VIEW || ACTIONS.PAYMENT_VIEW || ACTIONS.CASH_VIEW,
        ),
      ],
    },
    ownerLoanSummary,
  );

  app.get(
    "/owner-loans",
    {
      preHandler: [
        requirePermission(
          ACTIONS.OWNER_LOAN_VIEW || ACTIONS.PAYMENT_VIEW || ACTIONS.CASH_VIEW,
        ),
      ],
    },
    listOwnerLoans,
  );

  app.get(
    "/owner-loans/:id",
    {
      preHandler: [
        requirePermission(
          ACTIONS.OWNER_LOAN_VIEW || ACTIONS.PAYMENT_VIEW || ACTIONS.CASH_VIEW,
        ),
      ],
    },
    getOwnerLoan,
  );

  app.post(
    "/owner-loans",
    {
      preHandler: [
        requirePermission(
          ACTIONS.OWNER_LOAN_CREATE ||
            ACTIONS.PAYMENT_CREATE ||
            ACTIONS.CASH_CREATE,
        ),
      ],
    },
    createOwnerLoan,
  );

  app.patch(
    "/owner-loans/:id",
    {
      preHandler: [
        requirePermission(
          ACTIONS.OWNER_LOAN_UPDATE ||
            ACTIONS.PAYMENT_UPDATE ||
            ACTIONS.CASH_UPDATE,
        ),
      ],
    },
    updateOwnerLoan,
  );

  app.post(
    "/owner-loans/:id/repayments",
    {
      preHandler: [
        requirePermission(
          ACTIONS.OWNER_LOAN_REPAYMENT_CREATE ||
            ACTIONS.PAYMENT_CREATE ||
            ACTIONS.CASH_CREATE,
        ),
      ],
    },
    createOwnerLoanRepayment,
  );

  app.post(
    "/owner-loans/:id/void",
    {
      preHandler: [
        requirePermission(
          ACTIONS.OWNER_LOAN_VOID ||
            ACTIONS.PAYMENT_DELETE ||
            ACTIONS.CASH_DELETE,
        ),
      ],
    },
    voidOwnerLoan,
  );

  done();
}

module.exports = { ownerLoansRoutes };
