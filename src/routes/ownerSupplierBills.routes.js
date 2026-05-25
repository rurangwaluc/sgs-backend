"use strict";

const ACTIONS = require("../permissions/actions");
const { requireAnyPermission } = require("../middleware/requirePermission");
const {
  listOwnerSupplierBills,
  ownerSupplierBillsSummary,
  getOwnerSupplierBill,
} = require("../controllers/ownerSupplierBillsController");

async function ownerSupplierBillsRoutes(app) {
  app.get(
    "/owner/supplier-bills",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_BILL_VIEW]),
      ],
    },
    listOwnerSupplierBills,
  );

  app.get(
    "/owner/supplier-bills/summary",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_BILL_VIEW]),
      ],
    },
    ownerSupplierBillsSummary,
  );

  app.get(
    "/owner/supplier-bills/:id",
    {
      preHandler: [
        requireAnyPermission([ACTIONS.OWNER_ONLY, ACTIONS.SUPPLIER_BILL_VIEW]),
      ],
    },
    getOwnerSupplierBill,
  );
}

module.exports = { ownerSupplierBillsRoutes };
