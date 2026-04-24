"use strict";

const {
  listOwnerPaymentBusinessLoans,
  getOwnerPaymentBusinessLoansSummary,
  getOwnerPaymentBusinessLoanDetail,
  createOwnerPaymentBusinessLoan,
  createOwnerPaymentBusinessLoanRepayment,
} = require("../controllers/ownerPaymentsBusinessLoans.controller");

function getSessionUser(request) {
  return request.user || request.authUser || request.me || null;
}

async function ownerOnly(request, reply) {
  const user = getSessionUser(request);

  if (!user) {
    return reply.status(401).send({
      ok: false,
      error: "Authentication required",
    });
  }

  const role = String(user.role || "")
    .trim()
    .toLowerCase();

  if (role !== "owner") {
    return reply.status(403).send({
      ok: false,
      error: "Owner access required",
    });
  }
}

async function ownerPaymentsBusinessLoansRoutes(app) {
  app.get(
    "/owner/payments/business-loans",
    {
      preHandler: ownerOnly,
    },
    listOwnerPaymentBusinessLoans,
  );

  app.get(
    "/owner/payments/business-loans/summary",
    {
      preHandler: ownerOnly,
    },
    getOwnerPaymentBusinessLoansSummary,
  );

  app.get(
    "/owner/payments/business-loans/:id",
    {
      preHandler: ownerOnly,
    },
    getOwnerPaymentBusinessLoanDetail,
  );

  app.post(
    "/owner/payments/business-loans",
    {
      preHandler: ownerOnly,
    },
    createOwnerPaymentBusinessLoan,
  );

  app.post(
    "/owner/payments/business-loans/:id/repayments",
    {
      preHandler: ownerOnly,
    },
    createOwnerPaymentBusinessLoanRepayment,
  );
}

module.exports = ownerPaymentsBusinessLoansRoutes;
