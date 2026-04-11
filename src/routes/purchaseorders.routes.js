"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");

const {
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrderById,
} = require("../controllers/purchaseOrdersController");

async function purchaseOrdersRoutes(app) {
  app.get(
    "/purchase-orders",
    { preHandler: [requirePermission(ACTIONS.PURCHASE_ORDER_VIEW)] },
    listPurchaseOrders,
  );

  app.get(
    "/purchase-orders/:id",
    { preHandler: [requirePermission(ACTIONS.PURCHASE_ORDER_VIEW)] },
    getPurchaseOrderById,
  );

  app.post(
    "/purchase-orders",
    { preHandler: [requirePermission(ACTIONS.PURCHASE_ORDER_CREATE)] },
    createPurchaseOrder,
  );

  app.patch(
    "/purchase-orders/:id",
    { preHandler: [requirePermission(ACTIONS.PURCHASE_ORDER_UPDATE)] },
    updatePurchaseOrder,
  );

  app.post(
    "/purchase-orders/:id/approve",
    { preHandler: [requirePermission(ACTIONS.PURCHASE_ORDER_APPROVE)] },
    approvePurchaseOrder,
  );

  app.post(
    "/purchase-orders/:id/cancel",
    { preHandler: [requirePermission(ACTIONS.PURCHASE_ORDER_CANCEL)] },
    cancelPurchaseOrder,
  );
}

module.exports = { purchaseOrdersRoutes };
