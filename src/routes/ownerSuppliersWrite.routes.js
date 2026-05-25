"use strict";

const ACTIONS = require("../permissions/actions");
const { requireAnyPermission } = require("../middleware/requirePermission");
const ownerSuppliersWriteController = require("../controllers/ownerSuppliersWriteController");

async function ownerSuppliersWriteRoutes(app) {
  app.post(
    "/owner/suppliers",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_CREATE]),
      ],
    },
    ownerSuppliersWriteController.createOwnerSupplier,
  );

  app.patch(
    "/owner/suppliers/:id",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_UPDATE]),
      ],
    },
    ownerSuppliersWriteController.updateOwnerSupplier,
  );

  app.post(
    "/owner/suppliers/:id/deactivate",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_UPDATE]),
      ],
    },
    ownerSuppliersWriteController.deactivateOwnerSupplier,
  );

  app.post(
    "/owner/suppliers/:id/reactivate",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_UPDATE]),
      ],
    },
    ownerSuppliersWriteController.reactivateOwnerSupplier,
  );
}

module.exports = { ownerSuppliersWriteRoutes };
