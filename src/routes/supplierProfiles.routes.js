"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");

const {
  getSupplierProfile,
  createSupplierProfile,
  updateSupplierProfile,
  upsertSupplierProfile,
} = require("../controllers/supplierProfilesController");

async function supplierProfilesRoutes(app) {
  app.get(
    "/suppliers/:supplierId/profile",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_VIEW)] },
    getSupplierProfile,
  );

  app.post(
    "/suppliers/:supplierId/profile",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    createSupplierProfile,
  );

  app.patch(
    "/suppliers/:supplierId/profile",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    updateSupplierProfile,
  );

  app.put(
    "/suppliers/:supplierId/profile",
    { preHandler: [requirePermission(ACTIONS.SUPPLIER_UPDATE)] },
    upsertSupplierProfile,
  );
}

module.exports = { supplierProfilesRoutes };
