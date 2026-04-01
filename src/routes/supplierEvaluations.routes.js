"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");

const {
  getSupplierEvaluation,
  createSupplierEvaluation,
  updateSupplierEvaluation,
  upsertSupplierEvaluation,
} = require("../controllers/supplierEvaluationsController");

async function supplierEvaluationsRoutes(app) {
  app.get(
    "/suppliers/:supplierId/evaluation",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_VIEW)] },
    getSupplierEvaluation,
  );

  app.post(
    "/suppliers/:supplierId/evaluation",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    createSupplierEvaluation,
  );

  app.patch(
    "/suppliers/:supplierId/evaluation",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    updateSupplierEvaluation,
  );

  app.put(
    "/suppliers/:supplierId/evaluation",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    upsertSupplierEvaluation,
  );
}

module.exports = { supplierEvaluationsRoutes };
