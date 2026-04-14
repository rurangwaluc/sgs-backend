"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");
const {
  getPurchaseOrderPdf,
} = require("../controllers/purchaseOrdersPdfController");

async function purchaseOrdersPdfRoutes(app) {
  const pdfViewPermission =
    ACTIONS.PURCHASE_ORDER_PDF_VIEW || ACTIONS.PURCHASE_ORDER_VIEW;

  app.get(
    "/purchase-orders/:id/pdf",
    { preHandler: [requirePermission(pdfViewPermission)] },
    getPurchaseOrderPdf,
  );
}

module.exports = { purchaseOrdersPdfRoutes };
