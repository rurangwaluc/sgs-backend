"use strict";

const ACTIONS = require("../permissions/actions");
const { requireAnyPermission } = require("../middleware/requirePermission");
const {
  createOwnerSupplierBill,
  updateOwnerSupplierBill,
  addOwnerSupplierBillPayment,
  voidOwnerSupplierBill,
} = require("../controllers/ownerSupplierBillsWriteController");

async function ownerSupplierBillsWriteRoutes(app) {
  app.post(
    "/owner/supplier-bills",
    {
      preHandler: [
        requireAnyPermission([
          ACTIONS.OWNER_ONLY,
          ACTIONS.SUPPLIER_BILL_CREATE,
        ]),
      ],
    },
    createOwnerSupplierBill,
  );

  app.patch(
    "/owner/supplier-bills/:id",
    {
      preHandler: [
        requireAnyPermission([
          ACTIONS.OWNER_ONLY,
          ACTIONS.SUPPLIER_BILL_UPDATE,
        ]),
      ],
    },
    updateOwnerSupplierBill,
  );

  app.post(
    "/owner/supplier-bills/:id/payments",
    {
      preHandler: [
        requireAnyPermission([
          ACTIONS.OWNER_ONLY,
          ACTIONS.SUPPLIER_BILL_PAYMENT_CREATE,
        ]),
      ],
    },
    addOwnerSupplierBillPayment,
  );

  app.post(
    "/owner/supplier-bills/:id/void",
    {
      preHandler: [
        requireAnyPermission([
          ACTIONS.OWNER_ONLY,
          ACTIONS.SUPPLIER_BILL_DELETE,
        ]),
      ],
    },
    voidOwnerSupplierBill,
  );
}

module.exports = { ownerSupplierBillsWriteRoutes };
