"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");
const {
  createExpense,
  voidExpense,
  listExpenses,
} = require("../controllers/expensesController");

async function expensesRoutes(app) {
  app.get(
    "/cash/expenses",
    { preHandler: [requirePermission(ACTIONS.EXPENSE_VIEW)] },
    listExpenses,
  );

  app.post(
    "/cash/expenses",
    { preHandler: [requirePermission(ACTIONS.EXPENSE_CREATE)] },
    createExpense,
  );

  app.post(
    "/cash/expenses/:id/void",
    { preHandler: [requirePermission(ACTIONS.EXPENSE_VOID)] },
    voidExpense,
  );
}

module.exports = { expensesRoutes };
