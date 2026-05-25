"use strict";

const ACTIONS = require("../permissions/actions");
const {
  requirePermission,
  requireAnyPermission,
} = require("../middleware/requirePermission");

const {
  getOwnerSuppliersSummary,
  listOwnerSuppliers,
  getOwnerSupplier,
} = require("../controllers/ownerSuppliersController");

const {
  getSupplierProfile,
  createSupplierProfile,
  updateSupplierProfile,
  upsertSupplierProfile,
} = require("../controllers/supplierProfilesController");

async function ownerSuppliersRoutes(app) {
  app.get(
    "/owner/suppliers/summary",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_VIEW]),
      ],
    },
    getOwnerSuppliersSummary,
  );

  app.get(
    "/owner/suppliers",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_VIEW]),
      ],
    },
    listOwnerSuppliers,
  );

  app.get(
    "/owner/suppliers/:id",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_VIEW]),
      ],
    },
    getOwnerSupplier,
  );

  app.get(
    "/owner/suppliers/:supplierId/profile",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_VIEW]),
      ],
    },
    getSupplierProfile,
  );

  app.post(
    "/owner/suppliers/:supplierId/profile",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_UPDATE]),
      ],
    },
    createSupplierProfile,
  );

  app.patch(
    "/owner/suppliers/:supplierId/profile",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_UPDATE]),
      ],
    },
    updateSupplierProfile,
  );

  app.put(
    "/owner/suppliers/:supplierId/profile",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_UPDATE]),
      ],
    },
    upsertSupplierProfile,
  );
}

module.exports = { ownerSuppliersRoutes };
