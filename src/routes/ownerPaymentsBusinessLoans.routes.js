"use strict";

const {
  listOwnerPaymentBusinessLoans,
  getOwnerPaymentBusinessLoansSummary,
  getOwnerPaymentBusinessLoanDetail,
  createOwnerPaymentBusinessLoan,
  createOwnerPaymentBusinessLoanRepayment,
  voidOwnerPaymentBusinessLoan,
} = require("../controllers/ownerPaymentsBusinessLoans.controller");

function getSessionUser(request) {
  return request.user || request.authUser || request.me || null;
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

async function ownerOrAdminOnly(request, reply) {
  const user = getSessionUser(request);

  if (!user) {
    return reply.status(401).send({
      ok: false,
      error: "Authentication required",
    });
  }

  const role = normalizeRole(user.role);

  if (!["owner", "admin"].includes(role)) {
    return reply.status(403).send({
      ok: false,
      error: "Owner or admin access required",
    });
  }
}

async function ownerPaymentsBusinessLoansRoutes(app) {
  app.get(
    "/owner/payments/business-loans",
    {
      preHandler: ownerOrAdminOnly,
    },
    listOwnerPaymentBusinessLoans,
  );

  app.get(
    "/owner/payments/business-loans/summary",
    {
      preHandler: ownerOrAdminOnly,
    },
    getOwnerPaymentBusinessLoansSummary,
  );

  app.get(
    "/owner/payments/business-loans/:id",
    {
      preHandler: ownerOrAdminOnly,
    },
    getOwnerPaymentBusinessLoanDetail,
  );

  app.post(
    "/owner/payments/business-loans",
    {
      preHandler: ownerOrAdminOnly,
    },
    createOwnerPaymentBusinessLoan,
  );

  app.post(
    "/owner/payments/business-loans/:id/repayments",
    {
      preHandler: ownerOrAdminOnly,
    },
    createOwnerPaymentBusinessLoanRepayment,
  );

  app.post(
    "/owner/payments/business-loans/:id/void",
    {
      preHandler: ownerOrAdminOnly,
    },
    voidOwnerPaymentBusinessLoan,
  );
}

module.exports = ownerPaymentsBusinessLoansRoutes;
