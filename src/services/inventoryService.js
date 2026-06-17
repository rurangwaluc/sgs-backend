"use strict";

const { db } = require("../config/db");
const { products } = require("../db/schema/products.schema");
const { inventoryBalances } = require("../db/schema/inventory.schema");
const { internalNotes } = require("../db/schema/internal_notes.schema");
const { eq, and, sql } = require("drizzle-orm");
const { safeLogAudit } = require("./auditService");
const {
  cleanText,
  normalizeCategory,
  normalizeUnit,
  normalizePositiveInt,
} = require("../utils/productCatalog");

function buildProductDisplayName(row = {}) {
  return [
    cleanText(row.name, 160),
    cleanText(row.brand, 80),
    cleanText(row.model, 120),
    cleanText(row.size, 40),
    cleanText(row.color, 40),
    cleanText(row.variantLabel, 120),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function mapProductRow(row, includePurchasePrice = true) {
  if (!row) return null;

  const purchasePrice = Number(row.costPrice ?? row.purchasePrice ?? 0);
  const maxDiscountAmount = Number(
    row.maxDiscountAmount ?? row.max_discount_amount ?? 0,
  );

  return {
    id: Number(row.id),
    locationId: Number(row.locationId),
    name: row.name,
    displayName: buildProductDisplayName(row) || row.name || null,

    productType: row.productType ?? "HARDWARE",
    category: row.category ?? "GENERAL",
    subcategory: row.subcategory ?? null,

    sku: row.sku ?? null,
    barcode: row.barcode ?? null,
    supplierCode: row.supplierCode ?? null,

    brand: row.brand ?? null,
    model: row.model ?? null,
    variantLabel: row.variantLabel ?? null,
    size: row.size ?? null,
    color: row.color ?? null,
    material: row.material ?? null,

    gender: row.gender ?? null,
    season: row.season ?? null,

    unit: row.unit ?? "PIECE",

    sellingPrice: Number(row.sellingPrice ?? 0),
    costPrice: purchasePrice,
    purchasePrice: includePurchasePrice ? purchasePrice : null,

    maxDiscountPercent: Number(row.maxDiscountPercent ?? 0),
    maxDiscountAmount,

    reorderLevel: Number(row.reorderLevel ?? 0),

    isActive: row.isActive !== false,
    notes: row.notes ?? null,

    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,

    qtyOnHand:
      row.qtyOnHand === undefined || row.qtyOnHand === null
        ? undefined
        : Number(row.qtyOnHand || 0),

    stockUnit: row.stockUnit ?? row.unit ?? "PIECE",
    salesUnit: row.salesUnit ?? row.unit ?? "PIECE",
    purchaseUnit: row.purchaseUnit ?? row.unit ?? "PIECE",
    purchaseUnitFactor:
      row.purchaseUnitFactor === undefined || row.purchaseUnitFactor === null
        ? 1
        : Number(row.purchaseUnitFactor || 1),

    supplierSku: row.supplierSku ?? row.supplierCode ?? null,
    variantSummary: row.variantSummary ?? row.variantLabel ?? null,
    trackInventory: row.trackInventory ?? true,
    attributes: row.attributes ?? null,
  };
}

function buildProductUpdatePayload(data = {}) {
  const updates = {};

  if (data.name !== undefined) {
    updates.name = cleanText(data.name, 160);
  }

  if (data.sku !== undefined) {
    updates.sku = cleanText(data.sku, 80);
  }

  if (data.unit !== undefined || data.stockUnit !== undefined) {
    updates.unit = normalizeUnit(data.stockUnit || data.unit || "PIECE");
  }

  if (data.productType !== undefined) {
    updates.productType = cleanText(data.productType, 40) || "HARDWARE";
  }

  if (data.category !== undefined) {
    updates.category = normalizeCategory(data.category);
  }

  if (data.subcategory !== undefined) {
    updates.subcategory = cleanText(data.subcategory, 80);
  }

  if (data.brand !== undefined) {
    updates.brand = cleanText(data.brand, 80);
  }

  if (data.model !== undefined) {
    updates.model = cleanText(data.model, 120);
  }

  if (data.variantLabel !== undefined || data.variantSummary !== undefined) {
    updates.variantLabel =
      cleanText(data.variantLabel, 120) || cleanText(data.variantSummary, 120);
  }

  if (data.size !== undefined) {
    updates.size = cleanText(data.size, 40);
  }

  if (data.color !== undefined) {
    updates.color = cleanText(data.color, 40);
  }

  if (data.material !== undefined) {
    updates.material = cleanText(data.material, 80);
  }

  if (data.barcode !== undefined) {
    updates.barcode = cleanText(data.barcode, 120);
  }

  if (data.supplierCode !== undefined || data.supplierSku !== undefined) {
    updates.supplierCode =
      cleanText(data.supplierCode, 120) || cleanText(data.supplierSku, 120);
  }

  if (data.reorderLevel !== undefined) {
    updates.reorderLevel = normalizePositiveInt(data.reorderLevel, 0);
  }

  if (data.sellingPrice !== undefined) {
    updates.sellingPrice = normalizePositiveInt(data.sellingPrice, 0);
  }

  if (data.costPrice !== undefined || data.purchasePrice !== undefined) {
    updates.costPrice = normalizePositiveInt(
      data.costPrice ?? data.purchasePrice,
      0,
    );
  }

  if (data.maxDiscountPercent !== undefined) {
    updates.maxDiscountPercent = normalizePositiveInt(
      data.maxDiscountPercent,
      0,
    );
  }

  if (data.maxDiscountAmount !== undefined) {
    updates.maxDiscountAmount = normalizePositiveInt(data.maxDiscountAmount, 0);
  }

  if (data.notes !== undefined) {
    updates.notes = cleanText(data.notes, 4000);
  }

  updates.updatedAt = new Date();

  return updates;
}

async function createProduct({ locationId, userId, data }) {
  return db.transaction(async (tx) => {
    const openingQty = normalizePositiveInt(data.openingQty, 0);

    const name = cleanText(data.name, 160);
    const sku = cleanText(data.sku, 80);
    const unit = normalizeUnit(data.unit || "PIECE");

    const category = normalizeCategory(data.category);
    const subcategory = cleanText(data.subcategory, 80);

    const brand = cleanText(data.brand, 80);
    const model = cleanText(data.model, 120);
    const size = cleanText(data.size, 40);
    const color = cleanText(data.color, 40);
    const material = cleanText(data.material, 80);

    const variantLabel =
      cleanText(data.variantLabel, 120) || cleanText(data.variantSummary, 120);

    const supplierCode =
      cleanText(data.supplierCode, 120) || cleanText(data.supplierSku, 120);

    const [created] = await tx
      .insert(products)
      .values({
        locationId,
        name,
        sku,
        unit,

        productType: cleanText(data.productType, 40) || "HARDWARE",
        category,
        subcategory,

        brand,
        model,
        variantLabel,
        size,
        color,
        material,

        barcode: cleanText(data.barcode, 120),
        supplierCode,

        reorderLevel: normalizePositiveInt(data.reorderLevel, 0),

        sellingPrice: normalizePositiveInt(data.sellingPrice, 0),
        costPrice: normalizePositiveInt(data.costPrice, 0),
        maxDiscountPercent: normalizePositiveInt(data.maxDiscountPercent, 0),
        maxDiscountAmount: normalizePositiveInt(data.maxDiscountAmount, 0),

        isActive: true,
        notes: cleanText(data.notes, 4000),

        updatedAt: new Date(),
      })
      .returning();

    const [balance] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.locationId, locationId),
          eq(inventoryBalances.productId, created.id),
        ),
      );

    if (!balance) {
      await tx.insert(inventoryBalances).values({
        locationId,
        productId: created.id,
        qtyOnHand: openingQty,
        updatedAt: new Date(),
      });
    }

    const displayName = buildProductDisplayName(created) || created.name;

    await safeLogAudit({
      userId,
      action: "PRODUCT_CREATE",
      entity: "product",
      entityId: created.id,
      description: `Created product: ${displayName}`,
      meta: {
        productId: created.id,
        name: created.name,
        displayName,
        category: created.category,
        locationId,
        openingQty,
      },
      locationId,
    });

    return mapProductRow(
      {
        ...created,
        qtyOnHand: openingQty,
      },
      true,
    );
  });
}

async function updateProduct({ locationId, userId, productId, data }) {
  return db.transaction(async (tx) => {
    const found = await tx
      .select()
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      );

    if (!found[0]) {
      const err = new Error("Product not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    const updates = buildProductUpdatePayload(data);

    if (Object.keys(updates).length <= 1) {
      return mapProductRow(found[0], true);
    }

    const [updated] = await tx
      .update(products)
      .set(updates)
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      )
      .returning();

    const beforeName = buildProductDisplayName(found[0]) || found[0].name;
    const afterName = buildProductDisplayName(updated) || updated.name;

    await safeLogAudit({
      userId,
      action: "PRODUCT_UPDATE",
      entity: "product",
      entityId: productId,
      description: `Updated product: ${beforeName} → ${afterName}`,
      meta: {
        productId,
        locationId,
        changedFields: Object.keys(updates).filter((k) => k !== "updatedAt"),
      },
      locationId,
    });

    return mapProductRow(updated, true);
  });
}

async function listProducts({
  locationId,
  includePurchasePrice,
  includeInactive = false,
}) {
  const extraWhere = includeInactive ? sql`` : sql` AND p.is_active = true`;

  const result = await db.execute(sql`
    SELECT
      p.id,
      p.location_id as "locationId",
      p.name,
      p.product_type as "productType",
      p.category,
      p.subcategory,
      p.sku,
      p.barcode as "barcode",
      p.supplier_code as "supplierCode",
      p.brand,
      p.model,
      p.variant_label as "variantLabel",
      p.size,
      p.color,
      p.material,
      p.gender,
      p.season,
      p.unit,
      p.selling_price as "sellingPrice",
      p.cost_price as "purchasePrice",
      p.max_discount_percent as "maxDiscountPercent",
      p.max_discount_amount as "maxDiscountAmount",
      p.reorder_level as "reorderLevel",
      p.is_active as "isActive",
      p.notes,
      p.created_at as "createdAt",
      p.updated_at as "updatedAt",
      COALESCE(ib.qty_on_hand, 0)::bigint as "qtyOnHand"
    FROM products p
    LEFT JOIN inventory_balances ib
      ON ib.product_id = p.id
     AND ib.location_id = p.location_id
    WHERE p.location_id = ${locationId}
    ${extraWhere}
    ORDER BY p.id DESC
  `);

  const rows = result.rows || result || [];
  return rows.map((row) => mapProductRow(row, includePurchasePrice));
}

async function updateProductPricing({
  locationId,
  userId,
  productId,
  purchasePrice,
  sellingPrice,
  maxDiscountPercent,
  maxDiscountAmount,
}) {
  return db.transaction(async (tx) => {
    const found = await tx
      .select({
        id: products.id,
        name: products.name,
        brand: products.brand,
        model: products.model,
        size: products.size,
        color: products.color,
        variantLabel: products.variantLabel,
      })
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      );

    if (!found[0]) {
      const err = new Error("Product not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    const normalizedPurchasePrice = normalizePositiveInt(purchasePrice, 0);
    const normalizedSellingPrice = normalizePositiveInt(sellingPrice, 0);
    const normalizedMaxDiscountPercent = normalizePositiveInt(
      maxDiscountPercent,
      0,
    );
    const normalizedMaxDiscountAmount = normalizePositiveInt(
      maxDiscountAmount,
      0,
    );

    const [updated] = await tx
      .update(products)
      .set({
        costPrice: normalizedPurchasePrice,
        sellingPrice: normalizedSellingPrice,
        maxDiscountPercent: normalizedMaxDiscountPercent,
        maxDiscountAmount: normalizedMaxDiscountAmount,
        updatedAt: new Date(),
      })
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      )
      .returning();

    await safeLogAudit({
      userId,
      action: "PRODUCT_PRICING_UPDATE",
      entity: "product",
      entityId: productId,
      description: `Updated pricing for product #${productId}`,
      meta: {
        productId,
        purchasePrice: normalizedPurchasePrice,
        sellingPrice: normalizedSellingPrice,
        maxDiscountPercent: normalizedMaxDiscountPercent,
        maxDiscountAmount: normalizedMaxDiscountAmount,
        locationId,
      },
      locationId,
    });

    return mapProductRow(updated, true);
  });
}

async function getInventoryBalances({ locationId, includeInactive = false }) {
  const extraWhere = includeInactive ? sql`` : sql` AND p.is_active = true`;

  const result = await db.execute(sql`
    SELECT
      p.id,
      p.location_id as "locationId",
      p.name,
      p.product_type as "productType",
      p.category,
      p.subcategory,
      p.sku,
      p.barcode as "barcode",
      p.supplier_code as "supplierCode",
      p.brand,
      p.model,
      p.variant_label as "variantLabel",
      p.size,
      p.color,
      p.material,
      p.gender,
      p.season,
      p.unit,
      p.selling_price as "sellingPrice",
      p.cost_price as "purchasePrice",
      p.max_discount_percent as "maxDiscountPercent",
      p.max_discount_amount as "maxDiscountAmount",
      p.reorder_level as "reorderLevel",
      p.is_active as "isActive",
      p.notes,
      p.created_at as "createdAt",
      p.updated_at as "productUpdatedAt",
      b.qty_on_hand as "qtyOnHand",
      b.updated_at as "updatedAt"
    FROM products p
    LEFT JOIN inventory_balances b
      ON b.product_id = p.id
     AND b.location_id = p.location_id
    WHERE p.location_id = ${locationId}
    ${extraWhere}
    ORDER BY p.id DESC
  `);

  const rows = result.rows || result || [];
  return rows.map((row) => mapProductRow(row, true));
}

async function adjustInventory(
  { locationId, userId, productId, qtyChange, reason },
  tx,
) {
  const qty = Number(qtyChange);

  if (!Number.isFinite(qty) || qty === 0) {
    const err = new Error("qtyChange must be a non-zero number");
    err.code = "BAD_QTY_CHANGE";
    throw err;
  }

  const run = async (trx) => {
    const productRows = await trx
      .select({
        id: products.id,
        name: products.name,
        brand: products.brand,
        model: products.model,
        size: products.size,
        color: products.color,
        variantLabel: products.variantLabel,
        isActive: products.isActive,
      })
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      );

    if (!productRows[0]) {
      const err = new Error("Product not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    if (productRows[0].isActive === false) {
      const err = new Error("Product is archived");
      err.code = "ARCHIVED";
      throw err;
    }

    const [balanceRow] = await trx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.locationId, locationId),
          eq(inventoryBalances.productId, productId),
        ),
      );

    let newQty;

    if (balanceRow) {
      newQty = Number(balanceRow.qtyOnHand || 0) + qty;

      if (newQty < 0) {
        const err = new Error("Insufficient stock");
        err.code = "INSUFFICIENT_STOCK";
        throw err;
      }

      await trx
        .update(inventoryBalances)
        .set({ qtyOnHand: newQty, updatedAt: new Date() })
        .where(eq(inventoryBalances.id, balanceRow.id));
    } else {
      newQty = qty;

      if (newQty < 0) {
        const err = new Error("Insufficient stock");
        err.code = "INSUFFICIENT_STOCK";
        throw err;
      }

      await trx.insert(inventoryBalances).values({
        locationId,
        productId,
        qtyOnHand: newQty,
        updatedAt: new Date(),
      });
    }

    const productLabel =
      buildProductDisplayName(productRows[0]) || productRows[0].name;

    await safeLogAudit({
      userId: userId ?? null,
      action: "INVENTORY_ADJUST",
      entity: "product",
      entityId: productId,
      description: `Product ${productLabel}: qtyChange=${qty}. Reason: ${reason || "-"}`,
      meta: {
        productId,
        qtyChange: qty,
        reason: reason || null,
        locationId,
      },
      locationId,
    });

    return { productId, qtyOnHand: newQty };
  };

  if (tx) return run(tx);
  return db.transaction(async (trx) => run(trx));
}

async function archiveProduct({ locationId, userId, productId, reason }) {
  const cleanReason = cleanText(reason, 200);

  return db.transaction(async (tx) => {
    const found = await tx
      .select({
        id: products.id,
        name: products.name,
        brand: products.brand,
        model: products.model,
        size: products.size,
        color: products.color,
        variantLabel: products.variantLabel,
        isActive: products.isActive,
        notes: products.notes,
      })
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      );

    if (!found[0]) {
      const err = new Error("Product not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    if (found[0].isActive === false) {
      return mapProductRow(found[0], true);
    }

    const nextNotes = cleanReason
      ? `${String(found[0].notes || "").trim()}\n[ARCHIVED] ${cleanReason}`.trim()
      : found[0].notes;

    const [updated] = await tx
      .update(products)
      .set({
        isActive: false,
        notes: nextNotes,
        updatedAt: new Date(),
      })
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      )
      .returning();

    const productLabel = buildProductDisplayName(found[0]) || found[0].name;

    await safeLogAudit({
      userId,
      action: "PRODUCT_ARCHIVE",
      entity: "product",
      entityId: productId,
      description: `Archived product: ${productLabel}`,
      meta: { productId, reason: cleanReason, locationId },
      locationId,
    });

    return mapProductRow(updated, true);
  });
}

async function restoreProduct({ locationId, userId, productId }) {
  return db.transaction(async (tx) => {
    const found = await tx
      .select({
        id: products.id,
        name: products.name,
        brand: products.brand,
        model: products.model,
        size: products.size,
        color: products.color,
        variantLabel: products.variantLabel,
        isActive: products.isActive,
      })
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      );

    if (!found[0]) {
      const err = new Error("Product not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    if (found[0].isActive === true) {
      return mapProductRow(found[0], true);
    }

    const [updated] = await tx
      .update(products)
      .set({ isActive: true, updatedAt: new Date() })
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      )
      .returning();

    const productLabel = buildProductDisplayName(found[0]) || found[0].name;

    await safeLogAudit({
      userId,
      action: "PRODUCT_RESTORE",
      entity: "product",
      entityId: productId,
      description: `Restored product: ${productLabel}`,
      meta: { productId, locationId },
      locationId,
    });

    return mapProductRow(updated, true);
  });
}

async function deleteProductIfSafe({ locationId, userId, productId }) {
  return db.transaction(async (tx) => {
    const found = await tx
      .select({
        id: products.id,
        name: products.name,
        brand: products.brand,
        model: products.model,
        size: products.size,
        color: products.color,
        variantLabel: products.variantLabel,
      })
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      );

    if (!found[0]) {
      const err = new Error("Product not found");
      err.code = "NOT_FOUND";
      throw err;
    }

    const [balance] = await tx
      .select({ qtyOnHand: inventoryBalances.qtyOnHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.locationId, locationId),
          eq(inventoryBalances.productId, productId),
        ),
      );

    const qty = Number(balance?.qtyOnHand ?? 0);
    if (qty !== 0) {
      const err = new Error("Cannot delete: stock is not zero");
      err.code = "STOCK_NOT_ZERO";
      throw err;
    }

    const noteRows = await tx
      .select({ id: internalNotes.id })
      .from(internalNotes)
      .where(
        and(
          eq(internalNotes.locationId, locationId),
          eq(internalNotes.entityType, "product"),
          eq(internalNotes.entityId, productId),
        ),
      )
      .limit(1);

    if (noteRows.length > 0) {
      const err = new Error("Cannot delete: product has notes");
      err.code = "HAS_NOTES";
      throw err;
    }

    await tx
      .delete(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.locationId, locationId),
          eq(inventoryBalances.productId, productId),
        ),
      );

    await tx
      .delete(products)
      .where(
        and(eq(products.id, productId), eq(products.locationId, locationId)),
      );

    const productLabel = buildProductDisplayName(found[0]) || found[0].name;

    await safeLogAudit({
      userId,
      action: "PRODUCT_DELETE",
      entity: "product",
      entityId: productId,
      description: `Deleted product: ${productLabel}`,
      meta: { productId, locationId },
      locationId,
    });

    return { ok: true };
  });
}

module.exports = {
  createProduct,
  updateProduct,
  listProducts,
  updateProductPricing,
  getInventoryBalances,
  adjustInventory,
  archiveProduct,
  restoreProduct,
  deleteProductIfSafe,
};
