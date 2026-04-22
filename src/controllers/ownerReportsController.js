"use strict";

const ownerReportsService = require("../services/ownerReportsService");

function pickReportFilters(request) {
  return {
    locationId: request.query?.locationId || null,
    dateFrom: request.query?.dateFrom || null,
    dateTo: request.query?.dateTo || null,
    asOfDate: request.query?.asOfDate || request.query?.dateTo || null,
  };
}

async function getOwnerReportsOverview(request, reply) {
  try {
    const overview = await ownerReportsService.getOwnerReportsOverview(
      pickReportFilters(request),
    );

    return reply.send({ ok: true, overview });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerReportsOverview failed");
    return reply.status(500).send({
      error: "Failed to load owner reports overview",
      debug: e?.message || String(e),
    });
  }
}

async function getOwnerBranchPerformance(request, reply) {
  try {
    const rows = await ownerReportsService.getOwnerBranchPerformance(
      pickReportFilters(request),
    );

    return reply.send({ ok: true, branches: rows });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerBranchPerformance failed");
    return reply.status(500).send({
      error: "Failed to load owner branch performance",
      debug: e?.message || String(e),
    });
  }
}

async function getOwnerFinancialSummary(request, reply) {
  try {
    const summary = await ownerReportsService.getOwnerFinancialSummary(
      pickReportFilters(request),
    );

    return reply.send({ ok: true, summary });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerFinancialSummary failed");
    return reply.status(500).send({
      error: "Failed to load owner financial summary",
      debug: e?.message || String(e),
    });
  }
}

async function getOwnerCashFlowReport(request, reply) {
  try {
    const report = await ownerReportsService.getOwnerCashFlowReport(
      pickReportFilters(request),
    );

    return reply.send({ ok: true, report });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerCashFlowReport failed");
    return reply.status(500).send({
      error: "Failed to load owner cash flow report",
      debug: e?.message || String(e),
    });
  }
}

async function getOwnerTrialBalanceReport(request, reply) {
  try {
    const report = await ownerReportsService.getOwnerTrialBalanceReport(
      pickReportFilters(request),
    );

    return reply.send({ ok: true, report });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerTrialBalanceReport failed");
    return reply.status(500).send({
      error: "Failed to load owner trial balance report",
      debug: e?.message || String(e),
    });
  }
}

async function getOwnerIncomeStatementReport(request, reply) {
  try {
    const report = await ownerReportsService.getOwnerIncomeStatementReport(
      pickReportFilters(request),
    );

    return reply.send({ ok: true, report });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerIncomeStatementReport failed");
    return reply.status(500).send({
      error: "Failed to load owner income statement report",
      debug: e?.message || String(e),
    });
  }
}

async function getOwnerProfitTableReport(request, reply) {
  try {
    const report = await ownerReportsService.getOwnerProfitTableReport(
      pickReportFilters(request),
    );

    return reply.send({ ok: true, report });
  } catch (e) {
    request.log.error({ err: e }, "getOwnerProfitTableReport failed");
    return reply.status(500).send({
      error: "Failed to load owner profit table report",
      debug: e?.message || String(e),
    });
  }
}

module.exports = {
  getOwnerReportsOverview,
  getOwnerBranchPerformance,
  getOwnerFinancialSummary,
  getOwnerCashFlowReport,
  getOwnerTrialBalanceReport,
  getOwnerIncomeStatementReport,
  getOwnerProfitTableReport,
};
