"use strict";

const { db } = require("../config/db");
const { products } = require("../db/schema/products.schema");
const { auditLogs } = require("../db/schema/audit_logs.schema");
const { eq, and, asc } = require("drizzle-orm");
const { sql } = require("drizzle-orm");

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

  const currentDb = await db.execute(sql`
    select
      current_database() as db,
      current_schema() as schema,
      current_user as "user"
  `);
  console.log("APP DB IDENTITY:", currentDb.rows || currentDb);
  console.log("DATABASE_URL =", process.env.DATABASE_URL);

  const allProductColumns = await db.execute(sql`
    select
      table_schema,
      table_name,
      column_name,
      data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
    order by ordinal_position
  `);
  console.log(
    "APP PRODUCTS COLUMNS:",
    allProductColumns.rows || allProductColumns,
  );

  const singleColumnCheck = await db.execute(sql`
    select
      column_name,
      data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'max_discount_amount'
  `);
  console.log(
    "APP MAX DISCOUNT COLUMN CHECK:",
    singleColumnCheck.rows || singleColumnCheck,
  );

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
