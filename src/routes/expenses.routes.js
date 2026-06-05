"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");
const {
  createExpense,
  voidExpense,
  listExpenses,
} = require("../controllers/expensesController");
const {
  createExpenseRequest,
  listExpenseRequests,
  approveExpenseRequest,
  rejectExpenseRequest,
} = require("../controllers/expenseRequestsController");

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

async function requireAuthenticated(request, reply) {
  if (!request.user) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

async function requireExpenseSubmitter(request, reply) {
  if (!request.user) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const role = normalizeRole(request.user.role);

  if (!["owner", "admin", "manager", "cashier"].includes(role)) {
    return reply.status(403).send({
      error: "You are not allowed to submit expense records.",
    });
  }
}

async function requireOwnerForExpenseDecision(request, reply) {
  if (!request.user) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const role = normalizeRole(request.user.role);

  if (role !== "owner") {
    return reply.status(403).send({
      error: "Only owner can approve or reject expense requests.",
    });
  }
}

async function expensesRoutes(app) {
  app.get(
    "/cash/expenses",
    { preHandler: [requirePermission(ACTIONS.EXPENSE_VIEW)] },
    listExpenses,
  );

  app.post(
    "/cash/expenses",
    { preHandler: [requireExpenseSubmitter] },
    createExpense,
  );

  app.post(
    "/cash/expenses/:id/void",
    { preHandler: [requirePermission(ACTIONS.EXPENSE_VOID)] },
    voidExpense,
  );

  app.get(
    "/cash/expense-requests",
    { preHandler: [requireAuthenticated] },
    listExpenseRequests,
  );

  app.post(
    "/cash/expense-requests",
    { preHandler: [requireExpenseSubmitter] },
    createExpenseRequest,
  );

  app.post(
    "/cash/expense-requests/:id/approve",
    { preHandler: [requireOwnerForExpenseDecision] },
    approveExpenseRequest,
  );

  app.post(
    "/cash/expense-requests/:id/reject",
    { preHandler: [requireOwnerForExpenseDecision] },
    rejectExpenseRequest,
  );
}

module.exports = { expensesRoutes };
