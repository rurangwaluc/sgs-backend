"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");

const {
  createGoodsReceipt,
  listGoodsReceipts,
  getGoodsReceiptById,
} = require("../controllers/goodsReceiptsController");

async function goodsReceiptsRoutes(app) {
  app.get(
    "/goods-receipts",
    { preHandler: [requirePermission(ACTIONS.GOODS_RECEIPT_VIEW)] },
    listGoodsReceipts,
  );

  app.get(
    "/goods-receipts/:id",
    { preHandler: [requirePermission(ACTIONS.GOODS_RECEIPT_VIEW)] },
    getGoodsReceiptById,
  );

  app.post(
    "/goods-receipts",
    { preHandler: [requirePermission(ACTIONS.GOODS_RECEIPT_CREATE)] },
    createGoodsReceipt,
  );
}

module.exports = { goodsReceiptsRoutes };
