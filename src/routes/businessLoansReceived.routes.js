"use strict";

const {
  createBusinessLoanReceived,
  createBusinessLoanRepayment,
  listBusinessLoansReceived,
  getBusinessLoanReceivedSummary,
  getBusinessLoanReceivedById,
} = require("../controllers/businessLoansReceived.controller");

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

async function businessLoansReceivedRoutes(app) {
  app.get(
    "/owner/business-loans",
    {
      preHandler: ownerOnly,
    },
    listBusinessLoansReceived,
  );

  app.get(
    "/owner/business-loans/summary",
    {
      preHandler: ownerOnly,
    },
    getBusinessLoanReceivedSummary,
  );

  app.get(
    "/owner/business-loans/:id",
    {
      preHandler: ownerOnly,
    },
    getBusinessLoanReceivedById,
  );

  app.post(
    "/owner/business-loans",
    {
      preHandler: ownerOnly,
    },
    createBusinessLoanReceived,
  );

  app.post(
    "/owner/business-loans/:id/repayments",
    {
      preHandler: ownerOnly,
    },
    createBusinessLoanRepayment,
  );
}

module.exports = businessLoansReceivedRoutes;
