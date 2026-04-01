"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");
const ownerSuppliersWriteController = require("../controllers/ownerSuppliersWriteController");

async function ownerSuppliersWriteRoutes(app) {
  app.post(
    "/owner/suppliers",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    ownerSuppliersWriteController.createOwnerSupplier,
  );

  app.patch(
    "/owner/suppliers/:id",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    ownerSuppliersWriteController.updateOwnerSupplier,
  );

  app.post(
    "/owner/suppliers/:id/deactivate",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    ownerSuppliersWriteController.deactivateOwnerSupplier,
  );

  app.post(
    "/owner/suppliers/:id/reactivate",
    {
      preHandler: [requirePermission(ACTIONS.OWNER_ONLY)],
    },
    ownerSuppliersWriteController.reactivateOwnerSupplier,
  );
}

module.exports = { ownerSuppliersWriteRoutes };
