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
    "/owner/suppliers/:supplierId/evaluation",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_VIEW)] },
    getSupplierEvaluation,
  );

  app.post(
    "/owner/suppliers/:supplierId/evaluation",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    createSupplierEvaluation,
  );

  app.patch(
    "/owner/suppliers/:supplierId/evaluation",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    updateSupplierEvaluation,
  );

  app.put(
    "/owner/suppliers/:supplierId/evaluation",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    upsertSupplierEvaluation,
  );
}

module.exports = { supplierEvaluationsRoutes };
