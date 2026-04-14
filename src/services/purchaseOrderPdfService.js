"use strict";

const PDFDocument = require("pdfkit");
const { db } = require("../config/db");
const { sql } = require("drizzle-orm");

function toInt(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeText(value, fallback = "-") {
  const s = value == null ? "" : String(value).trim();
  return s || fallback;
}

function safeTextSoft(value, fallback = "") {
  const s = value == null ? "" : String(value).trim();
  return s || fallback;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCurrency(value) {
  return (
    String(value || "RWF")
      .trim()
      .toUpperCase() || "RWF"
  );
}

function formatMoney(value, currency = "RWF") {
  return `${normalizeCurrency(currency)} ${safeNumber(value, 0).toLocaleString()}`;
}

function formatDate(value) {
  if (!value) return "-";
  try {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return "-";
    return d.toISOString().slice(0, 10);
  } catch {
    return "-";
  }
}

function joinParts(parts, separator = " • ", fallback = "-") {
  const out = (Array.isArray(parts) ? parts : [])
    .map((x) => safeTextSoft(x))
    .filter(Boolean);
  return out.length ? out.join(separator) : fallback;
}

async function getPurchaseOrderPrintableData({
  purchaseOrderId,
  locationId = null,
}) {
  const id = toInt(purchaseOrderId, null);
  if (!id || id <= 0) {
    const err = new Error("Invalid purchase order id");
    err.statusCode = 400;
    throw err;
  }

  let whereSql = sql`po.id = ${id}`;
  if (locationId != null) {
    whereSql = sql`${whereSql} AND po.location_id = ${Number(locationId)}`;
  }

  const headRes = await db.execute(sql`
    SELECT
      po.id,
      po.location_id as "locationId",
      l.name as "locationName",
      l.code as "locationCode",
      l.email as "locationEmail",
      l.phone as "locationPhone",
      l.website as "locationWebsite",
      l.address as "locationAddress",
      l.logo_url as "locationLogoUrl",
      l.tin as "locationTin",

      po.supplier_id as "supplierId",
      s.name as "supplierName",
      s.contact_name as "supplierContactName",
      s.phone as "supplierPhone",
      s.email as "supplierEmail",
      s.address as "supplierAddress",

      po.po_no as "poNo",
      po.reference as "reference",
      po.currency as "currency",
      po.status as "status",
      po.notes as "notes",
      po.ordered_at as "orderedAt",
      po.expected_at as "expectedAt",
      po.approved_at as "approvedAt",
      po.subtotal_amount as "subtotalAmount",
      po.total_amount as "totalAmount",
      po.created_at as "createdAt",
      po.updated_at as "updatedAt",

      po.created_by_user_id as "createdByUserId",
      cu.name as "createdByName",
      cu.email as "createdByEmail",

      po.approved_by_user_id as "approvedByUserId",
      au.name as "approvedByName",
      au.email as "approvedByEmail"
    FROM purchase_orders po
    JOIN locations l
      ON l.id = po.location_id
    JOIN suppliers s
      ON s.id = po.supplier_id
    LEFT JOIN users cu
      ON cu.id = po.created_by_user_id
    LEFT JOIN users au
      ON au.id = po.approved_by_user_id
    WHERE ${whereSql}
    LIMIT 1
  `);

  const purchaseOrder = (headRes.rows || headRes || [])[0];
  if (!purchaseOrder) {
    const err = new Error("Purchase order not found");
    err.statusCode = 404;
    throw err;
  }

  const itemsRes = await db.execute(sql`
    SELECT
      poi.id,
      poi.purchase_order_id as "purchaseOrderId",
      poi.product_id as "productId",
      poi.product_name as "productName",
      poi.product_display_name as "productDisplayName",
      poi.product_sku as "productSku",
      poi.stock_unit as "stockUnit",
      poi.purchase_unit as "purchaseUnit",
      poi.purchase_unit_factor as "purchaseUnitFactor",
      poi.qty_ordered as "qtyOrdered",
      poi.qty_received as "qtyReceived",
      poi.unit_cost as "unitCost",
      poi.line_total as "lineTotal",
      poi.note as "note"
    FROM purchase_order_items poi
    WHERE poi.purchase_order_id = ${id}
    ORDER BY poi.id ASC
  `);

  const items = (itemsRes.rows || itemsRes || []).map((row) => ({
    id: safeNumber(row.id),
    purchaseOrderId: safeNumber(row.purchaseOrderId),
    productId: row.productId == null ? null : safeNumber(row.productId),
    productName: safeText(row.productName, ""),
    productDisplayName: safeText(row.productDisplayName || row.productName, ""),
    productSku: safeTextSoft(row.productSku, ""),
    stockUnit: safeText(row.stockUnit, "PIECE"),
    purchaseUnit: safeText(row.purchaseUnit, "PIECE"),
    purchaseUnitFactor: safeNumber(row.purchaseUnitFactor, 1),
    qtyOrdered: safeNumber(row.qtyOrdered, 0),
    qtyReceived: safeNumber(row.qtyReceived, 0),
    unitCost: safeNumber(row.unitCost, 0),
    lineTotal: safeNumber(row.lineTotal, 0),
    note: safeTextSoft(row.note, ""),
  }));

  return {
    purchaseOrder: {
      id: safeNumber(purchaseOrder.id),
      locationId: safeNumber(purchaseOrder.locationId),
      locationName: safeText(purchaseOrder.locationName),
      locationCode: safeTextSoft(purchaseOrder.locationCode, ""),
      locationEmail: safeTextSoft(purchaseOrder.locationEmail, ""),
      locationPhone: safeTextSoft(purchaseOrder.locationPhone, ""),
      locationWebsite: safeTextSoft(purchaseOrder.locationWebsite, ""),
      locationAddress: safeTextSoft(purchaseOrder.locationAddress, ""),
      locationLogoUrl: safeTextSoft(purchaseOrder.locationLogoUrl, ""),
      locationTin: safeTextSoft(purchaseOrder.locationTin, ""),

      supplierId: safeNumber(purchaseOrder.supplierId),
      supplierName: safeText(purchaseOrder.supplierName),
      supplierContactName: safeTextSoft(purchaseOrder.supplierContactName, ""),
      supplierPhone: safeTextSoft(purchaseOrder.supplierPhone, ""),
      supplierEmail: safeTextSoft(purchaseOrder.supplierEmail, ""),
      supplierAddress: safeTextSoft(purchaseOrder.supplierAddress, ""),

      poNo: safeText(purchaseOrder.poNo, `PO-${purchaseOrder.id}`),
      reference: safeTextSoft(purchaseOrder.reference, ""),
      currency: normalizeCurrency(purchaseOrder.currency),
      status: safeText(purchaseOrder.status, "DRAFT"),
      notes: safeTextSoft(purchaseOrder.notes, ""),
      orderedAt: purchaseOrder.orderedAt || null,
      expectedAt: purchaseOrder.expectedAt || null,
      approvedAt: purchaseOrder.approvedAt || null,
      subtotalAmount: safeNumber(purchaseOrder.subtotalAmount, 0),
      totalAmount: safeNumber(purchaseOrder.totalAmount, 0),
      createdAt: purchaseOrder.createdAt || null,
      updatedAt: purchaseOrder.updatedAt || null,

      createdByUserId:
        purchaseOrder.createdByUserId == null
          ? null
          : safeNumber(purchaseOrder.createdByUserId),
      createdByName: safeTextSoft(purchaseOrder.createdByName, ""),
      createdByEmail: safeTextSoft(purchaseOrder.createdByEmail, ""),
      approvedByUserId:
        purchaseOrder.approvedByUserId == null
          ? null
          : safeNumber(purchaseOrder.approvedByUserId),
      approvedByName: safeTextSoft(purchaseOrder.approvedByName, ""),
      approvedByEmail: safeTextSoft(purchaseOrder.approvedByEmail, ""),
    },
    items,
  };
}

const COLORS = {
  black: "#111111",
  muted: "#666666",
  line: "#D8D8D8",
  softer: "#FAFAFA",
  white: "#FFFFFF",
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  marginLeft: 38,
  marginRight: 38,
  marginTop: 34,
  marginBottom: 34,
};

function drawText(doc, str, x, y, options = {}) {
  doc.fillColor(options.color || COLORS.black);
  doc.font(options.font || "Helvetica");
  doc.fontSize(options.size || 10);
  doc.text(String(str == null ? "" : str), x, y, {
    width: options.width,
    align: options.align,
    ellipsis: options.ellipsis,
    lineGap: options.lineGap,
  });
}

function drawLine(doc, x1, y1, x2, y2, color = COLORS.line, width = 1) {
  doc
    .lineWidth(width)
    .strokeColor(color)
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .stroke();
}

function drawRect(doc, x, y, w, h, fill = null, stroke = null, lineWidth = 1) {
  if (fill) {
    doc.save();
    doc.fillColor(fill).rect(x, y, w, h).fill();
    doc.restore();
  }
  if (stroke) {
    doc.save();
    doc.lineWidth(lineWidth).strokeColor(stroke).rect(x, y, w, h).stroke();
    doc.restore();
  }
}

function sectionBar(doc, label, x, y, w, h = 18) {
  drawRect(doc, x, y, w, h, COLORS.black, null);
  drawText(doc, String(label || "").toUpperCase(), x, y + 4, {
    width: w,
    align: "center",
    font: "Helvetica-Bold",
    size: 9,
    color: COLORS.white,
  });
}

function valueLine(doc, label, value, x, y, w, labelW = 78) {
  drawText(doc, String(label || "").toUpperCase(), x, y, {
    width: labelW,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.black,
  });

  const lx = x + labelW + 6;
  const lw = Math.max(20, w - labelW - 6);

  drawLine(doc, lx, y + 10, lx + lw, y + 10, "#7A7A7A", 0.8);

  if (safeTextSoft(value)) {
    drawText(doc, safeTextSoft(value), lx + 3, y - 1, {
      width: lw - 6,
      font: "Helvetica",
      size: 9.5,
      color: COLORS.black,
      ellipsis: true,
    });
  }
}

function multiField(doc, label, value, x, y, w, minHeight = 34) {
  drawText(doc, String(label || "").toUpperCase(), x, y, {
    width: w,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.black,
  });

  drawLine(doc, x, y + 14, x + w, y + 14, "#7A7A7A", 0.8);

  const v = safeTextSoft(value, "");
  let rendered = 0;

  if (v) {
    rendered = doc.heightOfString(v, { width: w, align: "left" });
    drawText(doc, v, x, y + 18, {
      width: w,
      font: "Helvetica",
      size: 9.5,
      color: COLORS.black,
      lineGap: 1,
    });
  }

  return Math.max(minHeight, 18 + rendered);
}

function drawHeader(doc, purchaseOrder, continuation = false) {
  const left = PAGE.marginLeft;
  const right = PAGE.width - PAGE.marginRight;
  const top = PAGE.marginTop;
  const titleY = continuation ? top : top + 2;

  drawText(doc, "ORDER", left, titleY, {
    font: "Helvetica-Bold",
    size: 24,
  });
  drawText(doc, " SHEET", left + 80, titleY, {
    font: "Helvetica",
    size: 24,
  });

  valueLine(
    doc,
    "Order Date",
    formatDate(purchaseOrder.orderedAt || purchaseOrder.createdAt),
    right - 230,
    titleY + 5,
    105,
    62,
  );
  valueLine(
    doc,
    "Order #",
    safeText(purchaseOrder.poNo, `PO-${purchaseOrder.id}`),
    right - 112,
    titleY + 5,
    112,
    50,
  );

  if (!continuation) {
    drawLine(doc, left, titleY + 34, right, titleY + 34, COLORS.line, 1);
  }
}

function drawTopDetails(doc, purchaseOrder) {
  const x = PAGE.marginLeft + 5;
  const w = PAGE.width - PAGE.marginLeft - PAGE.marginRight - 10;
  let y = 92;

  sectionBar(doc, "Purchase Order Details", x, y, w, 18);
  y += 28;

  valueLine(doc, "Supplier", purchaseOrder.supplierName, x, y, 228, 68);
  valueLine(
    doc,
    "Branch",
    `${purchaseOrder.locationName}${purchaseOrder.locationCode ? ` (${purchaseOrder.locationCode})` : ""}`,
    320,
    y,
    230,
    58,
  );

  y += 38;

  multiField(
    doc,
    "Address",
    purchaseOrder.supplierAddress || purchaseOrder.locationAddress || "-",
    x,
    y,
    228,
    38,
  );

  valueLine(doc, "Reference", purchaseOrder.reference || "-", 320, y, 230, 70);

  y += 44;

  multiField(
    doc,
    "Contact",
    joinParts(
      [
        purchaseOrder.supplierContactName,
        purchaseOrder.supplierPhone,
        purchaseOrder.supplierEmail,
      ],
      " • ",
      "-",
    ),
    x,
    y,
    228,
    34,
  );

  valueLine(
    doc,
    "Expected",
    formatDate(purchaseOrder.expectedAt),
    320,
    y,
    230,
    62,
  );

  return y + 46;
}

function getColumns() {
  return [
    { key: "itemNo", label: "ITEM #", x: 43, width: 52, align: "center" },
    { key: "item", label: "ITEM", x: 95, width: 245, align: "left" },
    { key: "qty", label: "QTY", x: 340, width: 55, align: "center" },
    { key: "price", label: "PRICE", x: 395, width: 88, align: "right" },
    { key: "received", label: "RECEIVED", x: 483, width: 74, align: "center" },
  ];
}

function drawTableSkeleton(doc, yTop) {
  const left = 43;
  const right = 557;
  const bottom = 705;
  const headerH = 22;
  const cols = getColumns();

  drawRect(doc, left, yTop, right - left, headerH, COLORS.black, null);
  cols.forEach((col) => {
    drawText(doc, col.label, col.x, yTop + 6, {
      width: col.width,
      align: "center",
      font: "Helvetica-Bold",
      size: 8.5,
      color: COLORS.white,
    });
  });

  drawRect(
    doc,
    left,
    yTop + headerH,
    right - left,
    bottom - (yTop + headerH),
    null,
    COLORS.black,
    1,
  );

  const verticals = [95, 340, 395, 483];
  verticals.forEach((vx) =>
    drawLine(doc, vx, yTop + headerH, vx, bottom, "#4A4A4A", 0.8),
  );

  return {
    left,
    right,
    top: yTop + headerH,
    bottom,
    cols,
    contentY: yTop + headerH + 4,
  };
}

function measureItemBlock(doc, item, itemWidth) {
  const itemName = safeText(item.productDisplayName || item.productName, "-");
  const sku = safeTextSoft(item.productSku, "");
  const unit = safeTextSoft(item.purchaseUnit, "");
  const baseLine = [
    itemName,
    sku ? `SKU: ${sku}` : "",
    unit ? `Unit: ${unit}` : "",
  ]
    .filter(Boolean)
    .join(" • ");

  const baseH = Math.max(
    14,
    doc.heightOfString(baseLine, {
      width: itemWidth,
      align: "left",
    }),
  );

  const note = safeTextSoft(item.note, "");
  const noteH = note
    ? doc.heightOfString(`Note: ${note}`, {
        width: itemWidth,
        align: "left",
      }) + 8
    : 0;

  return {
    baseLine,
    note,
    height: Math.max(18, baseH + noteH + 4),
    baseH,
  };
}

function drawItemRow(doc, rowIndex, item, currency, layout, y) {
  const cols = layout.cols;
  const itemCol = cols.find((c) => c.key === "item");
  const qtyCol = cols.find((c) => c.key === "qty");
  const priceCol = cols.find((c) => c.key === "price");
  const receivedCol = cols.find((c) => c.key === "received");

  const measured = measureItemBlock(doc, item, itemCol.width - 8);

  if (rowIndex % 2 === 0) {
    drawRect(
      doc,
      layout.left + 1,
      y - 2,
      layout.right - layout.left - 2,
      measured.height,
      COLORS.softer,
      null,
    );
  }

  drawText(doc, String(rowIndex + 1), cols[0].x + 2, y + 1, {
    width: cols[0].width - 4,
    align: "center",
    font: "Helvetica",
    size: 9,
  });

  drawText(doc, measured.baseLine, itemCol.x + 4, y + 1, {
    width: itemCol.width - 8,
    align: "left",
    font: "Helvetica",
    size: 9,
    color: COLORS.black,
    lineGap: 1,
  });

  drawText(doc, String(safeNumber(item.qtyOrdered, 0)), qtyCol.x + 2, y + 1, {
    width: qtyCol.width - 4,
    align: "center",
    font: "Helvetica",
    size: 9,
  });

  drawText(doc, formatMoney(item.unitCost, currency), priceCol.x + 2, y + 1, {
    width: priceCol.width - 6,
    align: "right",
    font: "Helvetica",
    size: 9,
  });

  drawText(
    doc,
    String(safeNumber(item.qtyReceived, 0)),
    receivedCol.x + 2,
    y + 1,
    {
      width: receivedCol.width - 4,
      align: "center",
      font: "Helvetica",
      size: 9,
    },
  );

  if (measured.note) {
    drawText(
      doc,
      `Note: ${measured.note}`,
      itemCol.x + 4,
      y + measured.baseH + 1,
      {
        width: itemCol.width - 8,
        align: "left",
        font: "Helvetica-Oblique",
        size: 8,
        color: COLORS.muted,
      },
    );
  }

  return measured.height;
}

function estimateFooterHeight(doc, purchaseOrder) {
  let height = 0;
  height += 34;
  const notesText = purchaseOrder.notes || "-";
  const notesHeight = doc.heightOfString(notesText, { width: 512 }) + 24;
  height += Math.max(42, notesHeight);
  height += 28;
  height += 34;
  height += 34;
  return height;
}

function drawFooter(doc, purchaseOrder) {
  const currency = normalizeCurrency(purchaseOrder.currency);
  let y = 724;

  valueLine(doc, "Status", safeText(purchaseOrder.status, "-"), 43, y, 145, 48);
  valueLine(
    doc,
    "Approved",
    formatDate(purchaseOrder.approvedAt),
    205,
    y,
    145,
    62,
  );
  valueLine(
    doc,
    "Total Price",
    formatMoney(purchaseOrder.totalAmount, currency),
    375,
    y,
    180,
    74,
  );

  y += 34;

  const notesUsed = multiField(
    doc,
    "Notes",
    purchaseOrder.notes || "-",
    43,
    y,
    512,
    34,
  );
  y += Math.max(38, notesUsed + 6);

  sectionBar(doc, "Approval / Receiving Context", 43, y, 512, 18);
  y += 28;

  valueLine(
    doc,
    "Created By",
    joinParts(
      [purchaseOrder.createdByName, purchaseOrder.createdByEmail],
      " • ",
      "-",
    ),
    43,
    y,
    235,
    78,
  );

  valueLine(
    doc,
    "Updated",
    formatDate(purchaseOrder.updatedAt),
    320,
    y,
    235,
    56,
  );
  y += 34;

  valueLine(
    doc,
    "Approved By",
    joinParts(
      [purchaseOrder.approvedByName, purchaseOrder.approvedByEmail],
      " • ",
      "-",
    ),
    43,
    y,
    235,
    90,
  );

  valueLine(
    doc,
    "Expected",
    formatDate(purchaseOrder.expectedAt),
    320,
    y,
    235,
    62,
  );
}

function generatePurchaseOrderPdfBuffer({ purchaseOrder, items }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 0,
      compress: true,
      bufferPages: false,
      autoFirstPage: true,
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeader(doc, purchaseOrder, false);
    const firstPageDetailsBottom = drawTopDetails(doc, purchaseOrder);
    const tableTop = Math.max(272, firstPageDetailsBottom + 8);

    const footerHeight = estimateFooterHeight(doc, purchaseOrder);
    const footerReserve = footerHeight + 16;

    const measured = items.map((item) => measureItemBlock(doc, item, 237));
    const firstPageRows = [];
    let used = 0;
    const firstPageLimit = 695 - footerReserve;
    const availableFirstPage = firstPageLimit - (tableTop + 26);

    for (let i = 0; i < measured.length; i += 1) {
      if (used + measured[i].height > availableFirstPage) break;
      firstPageRows.push(items[i]);
      used += measured[i].height;
    }

    drawText(doc, "ORDER DETAILS", 208, tableTop - 22, {
      width: 180,
      align: "center",
      font: "Helvetica-Bold",
      size: 15,
    });

    const firstLayout = drawTableSkeleton(doc, tableTop);
    let currentY = firstLayout.contentY;

    firstPageRows.forEach((item, idx) => {
      const h = drawItemRow(
        doc,
        idx,
        item,
        purchaseOrder.currency,
        firstLayout,
        currentY,
      );
      currentY += h;
    });

    const remainingItems = items.slice(firstPageRows.length);
    let absoluteOffset = firstPageRows.length;

    while (remainingItems.length) {
      doc.addPage();
      drawHeader(doc, purchaseOrder, true);

      drawText(doc, "ORDER DETAILS", 208, 108, {
        width: 180,
        align: "center",
        font: "Helvetica-Bold",
        size: 15,
      });

      const layout = drawTableSkeleton(doc, 128);
      let y = layout.contentY;
      let taken = 0;

      while (taken < remainingItems.length) {
        const block = measureItemBlock(doc, remainingItems[taken], 237);
        const isLastBatchPage = taken === remainingItems.length - 1;
        const pageLimit = isLastBatchPage ? 705 - footerReserve : 705;

        if (y + block.height > pageLimit) break;

        const h = drawItemRow(
          doc,
          absoluteOffset + taken,
          remainingItems[taken],
          purchaseOrder.currency,
          layout,
          y,
        );
        y += h;
        taken += 1;
      }

      if (taken === 0) {
        const h = drawItemRow(
          doc,
          absoluteOffset,
          remainingItems[0],
          purchaseOrder.currency,
          layout,
          y,
        );
        y += h;
        taken = 1;
      }

      remainingItems.splice(0, taken);
      absoluteOffset += taken;

      if (!remainingItems.length) {
        drawFooter(doc, purchaseOrder);
      }
    }

    if (
      !items.length ||
      (!remainingItems.length && firstPageRows.length === items.length)
    ) {
      drawFooter(doc, purchaseOrder);
    }

    doc.end();
  });
}

async function buildPurchaseOrderPdfBuffer({
  purchaseOrderId,
  locationId = null,
}) {
  const data = await getPurchaseOrderPrintableData({
    purchaseOrderId,
    locationId,
  });

  const buffer = await generatePurchaseOrderPdfBuffer(data);

  return {
    fileName:
      `${safeText(data.purchaseOrder.poNo, `purchase-order-${data.purchaseOrder.id}`)}.pdf`
        .replace(/[\\/:*?"<>|]+/g, "-")
        .replace(/\s+/g, "-"),
    mimeType: "application/pdf",
    buffer,
    data,
  };
}

module.exports = {
  getPurchaseOrderPrintableData,
  generatePurchaseOrderPdfBuffer,
  buildPurchaseOrderPdfBuffer,
};
