"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");
const {
  createExpense,
  voidExpense,
  listExpenses,
} = require("../controllers/expensesController");

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

async function requireOwnerForExpenseCreation(request, reply) {
  if (!request.user) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const role = normalizeRole(request.user.role);

  if (role !== "owner") {
    return reply.status(403).send({
      error: "Owner approval is required before this expense can be recorded.",
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
    { preHandler: [requireOwnerForExpenseCreation] },
    createExpense,
  );

  app.post(
    "/cash/expenses/:id/void",
    { preHandler: [requirePermission(ACTIONS.EXPENSE_VOID)] },
    voidExpense,
  );
}

module.exports = { expensesRoutes };
