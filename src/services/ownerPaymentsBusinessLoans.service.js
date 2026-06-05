"use strict";

const businessLoansReceivedService = require("./businessLoansReceived.service");

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function parseFilters(input = {}) {
  return {
    locationId: input.locationId || null,
    status: input.status || null,
    q: input.q || null,
    limit: input.limit || null,
  };
}

async function getBusinessLoansListForOwnerPayments(input = {}) {
  const filters = parseFilters(input);

  const [summary, rows] = await Promise.all([
    businessLoansReceivedService.getBusinessLoansReceivedSummary(filters),
    businessLoansReceivedService.listBusinessLoansReceived(filters),
  ]);

  return {
    summary,
    rows: Array.isArray(rows) ? rows : [],
  };
}

async function getBusinessLoansSummaryForOwnerPayments(input = {}) {
  const filters = parseFilters(input);
  return businessLoansReceivedService.getBusinessLoansReceivedSummary(filters);
}

async function getBusinessLoanDetailForOwnerPayments(id) {
  const loanId = toInt(id, null);
  if (!loanId || loanId <= 0) {
    throw new Error("Valid business loan id is required");
  }

  const result =
    await businessLoansReceivedService.getBusinessLoanReceivedById(loanId);

  if (!result?.loan) {
    throw new Error("Business loan not found");
  }

  return result;
}

async function receiveBusinessLoanFromOwnerPayments(input = {}, actor = {}) {
  return businessLoansReceivedService.receiveBusinessLoan(input, actor);
}

async function repayBusinessLoanFromOwnerPayments(
  businessLoanId,
  input = {},
  actor = {},
) {
  const loanId = toInt(businessLoanId, null);
  if (!loanId || loanId <= 0) {
    throw new Error("Valid business loan id is required");
  }

  return businessLoansReceivedService.repayBusinessLoan(
    {
      ...input,
      businessLoanId: loanId,
    },
    actor,
  );
}

async function voidBusinessLoanFromOwnerPayments(
  businessLoanId,
  input = {},
  actor = {},
) {
  const loanId = toInt(businessLoanId, null);
  if (!loanId || loanId <= 0) {
    throw new Error("Valid business loan id is required");
  }

  return businessLoansReceivedService.voidBusinessLoan(
    {
      ...input,
      businessLoanId: loanId,
    },
    actor,
  );
}

module.exports = {
  getBusinessLoansListForOwnerPayments,
  getBusinessLoansSummaryForOwnerPayments,
  getBusinessLoanDetailForOwnerPayments,
  receiveBusinessLoanFromOwnerPayments,
  repayBusinessLoanFromOwnerPayments,
  voidBusinessLoanFromOwnerPayments,
};
