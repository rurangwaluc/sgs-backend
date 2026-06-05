"use strict";

const { db } = require("../config/db");
const { products } = require("../db/schema/products.schema");
const { auditLogs } = require("../db/schema/audit_logs.schema");
const { eq, and, asc } = require("drizzle-orm");

async function getProducts({ locationId }) {
  if (!locationId) {
    const err = new Error("Missing locationId");
    err.code = "BAD_CONTEXT";
    throw err;
  }

  return db
    .select()
    .from(products)
    .where(eq(products.locationId, locationId))
    .orderBy(asc(products.name));
}

async function updatePricing({
  locationId,
  productId,
  purchasePrice,
  sellingPrice,
  maxDiscountPercent,
  maxDiscountAmount,
  userId,
}) {
  const pp = Number(purchasePrice);
  const sp = Number(sellingPrice);

  const mdPercentRaw =
    maxDiscountPercent === undefined || maxDiscountPercent === null
      ? 0
      : maxDiscountPercent;
  const mdPercent = Number(mdPercentRaw);

  const mdAmountRaw =
    maxDiscountAmount === undefined || maxDiscountAmount === null
      ? 0
      : maxDiscountAmount;
  const mdAmount = Number(mdAmountRaw);

  if (!Number.isFinite(pp) || pp < 0) {
    const err = new Error("Purchase price must be >= 0");
    err.code = "BAD_PRICE";
    throw err;
  }

  if (!Number.isFinite(sp) || sp <= 0) {
    const err = new Error("Selling price must be > 0");
    err.code = "BAD_PRICE";
    throw err;
  }

  if (!Number.isFinite(mdPercent) || mdPercent < 0 || mdPercent > 100) {
    const err = new Error("maxDiscountPercent must be between 0 and 100");
    err.code = "BAD_PRICE";
    throw err;
  }

  if (!Number.isFinite(mdAmount) || mdAmount < 0) {
    const err = new Error("maxDiscountAmount must be >= 0");
    err.code = "BAD_PRICE";
    throw err;
  }

  if (sp < pp) {
    const err = new Error("Selling price cannot be below purchase price");
    err.code = "BAD_PRICE";
    throw err;
  }

  if (mdAmount > sp) {
    const err = new Error(
      "maxDiscountAmount cannot be greater than selling price",
    );
    err.code = "BAD_PRICE";
    throw err;
  }

  if (!locationId) {
    const err = new Error("Missing locationId");
    err.code = "BAD_CONTEXT";
    throw err;
  }

  if (!userId) {
    const err = new Error("Missing userId");
    err.code = "BAD_CONTEXT";
    throw err;
  }

  const [product] = await db
    .update(products)
    .set({
      costPrice: pp,
      sellingPrice: sp,
      maxDiscountPercent: mdPercent,
      maxDiscountAmount: mdAmount,
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, productId), eq(products.locationId, locationId)))
    .returning();

  if (!product) {
    const err = new Error("Product not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  await db.insert(auditLogs).values({
    locationId,
    userId,
    action: "PRODUCT_PRICING_UPDATE",
    entity: "product",
    entityId: productId,
    description: `Pricing updated: purchase=${pp}, selling=${sp}, maxDiscountPercent=${mdPercent}%, maxDiscountAmount=${mdAmount}`,
  });

  return product;
}

module.exports = {
  getProducts,
  updatePricing,
};
