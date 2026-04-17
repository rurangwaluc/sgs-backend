"use strict";

const PDFDocument = require("pdfkit");
const { db } = require("../config/db");
const { sql } = require("drizzle-orm");
const fs = require("fs");
const path = require("path");

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

function hasMeaningfulNotes(value) {
  const s = safeTextSoft(value, "");
  if (!s) return false;
  const low = s.toLowerCase();
  if (["test", "ok", "none", "n/a", "-", "."].includes(low)) return false;
  return s.length >= 4;
}

function isHttpUrl(value) {
  const s = safeTextSoft(value, "");
  return s.startsWith("http://") || s.startsWith("https://");
}

function isDataUrl(value) {
  const s = safeTextSoft(value, "");
  return s.startsWith("data:image/");
}

function resolveLocalAssetPath(value) {
  const raw = safeTextSoft(value, "");
  if (!raw) return "";

  if (path.isAbsolute(raw) && fs.existsSync(raw)) {
    return raw;
  }

  const normalized = raw.replace(/^\/+/, "");

  const candidates = [
    path.resolve(process.cwd(), raw),
    path.resolve(process.cwd(), normalized),
    path.resolve(process.cwd(), "public", normalized),
    path.resolve(process.cwd(), "..", normalized),
    path.resolve(process.cwd(), "..", "public", normalized),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "";
}

async function loadLogoBuffer(logoUrl) {
  const raw = safeTextSoft(logoUrl, "");
  if (!raw) return null;

  try {
    if (isDataUrl(raw)) {
      const commaIndex = raw.indexOf(",");
      if (commaIndex === -1) return null;
      const base64 = raw.slice(commaIndex + 1);
      return Buffer.from(base64, "base64");
    }

    if (isHttpUrl(raw)) {
      const res = await fetch(raw);
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    }

    const localPath = resolveLocalAssetPath(raw);
    if (localPath) {
      return fs.readFileSync(localPath);
    }

    return null;
  } catch {
    return null;
  }
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

      poNo: safeText(purchaseOrder.poNo),
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
  ink: "#111827",
  black: "#111111",
  text: "#1F2937",
  muted: "#6B7280",
  lightText: "#9CA3AF",
  line: "#D1D5DB",
  lineDark: "#9CA3AF",
  softLine: "#E5E7EB",
  soft: "#F9FAFB",
  softCard: "#F3F4F6",
  brand: "#111827",
  white: "#FFFFFF",
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  marginLeft: 36,
  marginRight: 36,
  marginTop: 30,
  marginBottom: 30,
};

function drawText(doc, str, x, y, options = {}) {
  doc.fillColor(options.color || COLORS.text);
  doc.font(options.font || "Helvetica");
  doc.fontSize(options.size || 10);
  doc.text(String(str == null ? "" : str), x, y, {
    width: options.width,
    align: options.align,
    ellipsis: options.ellipsis,
    lineGap: options.lineGap,
    lineBreak: options.lineBreak,
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

function drawRoundedRect(
  doc,
  x,
  y,
  w,
  h,
  r = 8,
  fill = null,
  stroke = null,
  lineWidth = 1,
) {
  if (fill) {
    doc.save();
    doc.fillColor(fill).roundedRect(x, y, w, h, r).fill();
    doc.restore();
  }
  if (stroke) {
    doc.save();
    doc
      .lineWidth(lineWidth)
      .strokeColor(stroke)
      .roundedRect(x, y, w, h, r)
      .stroke();
    doc.restore();
  }
}

function sectionTitle(doc, label, x, y, w) {
  drawText(doc, String(label || "").toUpperCase(), x, y, {
    width: w,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.muted,
  });
  drawLine(doc, x, y + 14, x + w, y + 14, COLORS.softLine, 1);
}

function infoRow(doc, label, value, x, y, w, labelW = 80) {
  drawText(doc, label, x, y, {
    width: labelW,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.muted,
  });
  drawText(doc, safeTextSoft(value, "-"), x + labelW + 8, y, {
    width: w - labelW - 8,
    font: "Helvetica",
    size: 9.5,
    color: COLORS.text,
    ellipsis: true,
  });
}

function drawLogoFallback(doc, x, y, size, label = "LOGO") {
  drawRoundedRect(doc, x, y, size, size, 12, COLORS.white, COLORS.softLine, 1);

  drawText(doc, safeText(label).slice(0, 8), x, y + size / 2 - 8, {
    width: size,
    align: "center",
    font: "Helvetica-Bold",
    size: 10,
    color: COLORS.muted,
  });
}

function drawHeader(
  doc,
  purchaseOrder,
  continuation = false,
  logoBuffer = null,
) {
  const left = PAGE.marginLeft;
  const right = PAGE.width - PAGE.marginRight;
  const top = PAGE.marginTop;

  if (!continuation) {
    drawRoundedRect(doc, left, top, right - left, 88, 14, COLORS.brand, null);
  } else {
    drawRoundedRect(doc, left, top, right - left, 66, 14, COLORS.brand, null);
  }

  const logoSize = continuation ? 42 : 58;
  const logoX = left + 16;
  const logoY = top + (continuation ? 12 : 15);

  if (logoBuffer) {
    try {
      drawRoundedRect(
        doc,
        logoX,
        logoY,
        logoSize,
        logoSize,
        12,
        COLORS.white,
        COLORS.softLine,
        1,
      );

      doc.image(logoBuffer, logoX + 4, logoY + 4, {
        fit: [logoSize - 8, logoSize - 8],
        align: "center",
        valign: "center",
      });
    } catch {
      drawLogoFallback(
        doc,
        logoX,
        logoY,
        logoSize,
        purchaseOrder.locationCode || purchaseOrder.locationName || "LOGO",
      );
    }
  } else {
    drawLogoFallback(
      doc,
      logoX,
      logoY,
      logoSize,
      purchaseOrder.locationCode || purchaseOrder.locationName || "LOGO",
    );
  }

  const textX = logoX + logoSize + 14;
  const textW = 190;

  drawText(doc, purchaseOrder.locationName || "Business", textX, top + 16, {
    width: textW,
    font: "Helvetica-Bold",
    size: continuation ? 15 : 18,
    color: COLORS.white,
  });

  drawText(
    doc,
    purchaseOrder.locationCode
      ? `Branch code: ${purchaseOrder.locationCode}`
      : "Branch",
    textX,
    top + (continuation ? 36 : 40),
    {
      width: textW,
      font: "Helvetica",
      size: 9,
      color: "#E5E7EB",
    },
  );

  if (!continuation) {
    const contactBits = [
      safeTextSoft(purchaseOrder.locationPhone, ""),
      safeTextSoft(purchaseOrder.locationEmail, ""),
      safeTextSoft(purchaseOrder.locationWebsite, ""),
    ].filter(Boolean);

    if (contactBits.length) {
      drawText(doc, contactBits.join(" • "), textX, top + 54, {
        width: 250,
        font: "Helvetica",
        size: 8.5,
        color: "#E5E7EB",
        ellipsis: true,
      });
    }

    drawText(doc, "PURCHASE ORDER", textX, top + 69, {
      width: 240,
      font: "Helvetica-Bold",
      size: 11,
      color: "#D1D5DB",
    });
  } else {
    drawText(doc, "PURCHASE ORDER", textX, top + 49, {
      width: 220,
      font: "Helvetica-Bold",
      size: 12.5,
      color: COLORS.white,
    });
  }

  const metaW = 208;
  const metaX = right - metaW - 14;
  const metaY = top + 10;
  const metaH = continuation ? 46 : 66;

  drawRoundedRect(doc, metaX, metaY, metaW, metaH, 10, COLORS.white, null);

  drawText(doc, "ORDER DATE", metaX + 12, metaY + 9, {
    width: 70,
    font: "Helvetica-Bold",
    size: 7.5,
    color: COLORS.muted,
  });
  drawText(
    doc,
    formatDate(purchaseOrder.orderedAt || purchaseOrder.createdAt),
    metaX + 92,
    metaY + 8,
    {
      width: metaW - 104,
      align: "right",
      font: "Helvetica-Bold",
      size: 10,
      color: COLORS.ink,
      lineBreak: false,
    },
  );

  drawLine(
    doc,
    metaX + 12,
    metaY + 26,
    metaX + metaW - 12,
    metaY + 26,
    COLORS.softLine,
    1,
  );

  const orderNoText = safeText(purchaseOrder.poNo);
  doc.save();
  doc.font("Helvetica-Bold");
  doc.fontSize(orderNoText.length > 24 ? 9.2 : 10);
  doc.fillColor(COLORS.ink);

  drawText(doc, "ORDER NUMBER", metaX + 12, metaY + 35, {
    width: 82,
    font: "Helvetica-Bold",
    size: 7.5,
    color: COLORS.muted,
  });

  doc.text(orderNoText, metaX + 98, metaY + 34, {
    width: metaW - 110,
    align: "right",
    ellipsis: true,
    lineBreak: false,
  });
  doc.restore();

  if (!continuation) {
    drawLine(
      doc,
      metaX + 12,
      metaY + 50,
      metaX + metaW - 12,
      metaY + 50,
      COLORS.softLine,
      1,
    );

    drawText(doc, "STATUS", metaX + 12, metaY + 56, {
      width: 60,
      font: "Helvetica-Bold",
      size: 7.5,
      color: COLORS.muted,
    });

    drawText(
      doc,
      safeText(purchaseOrder.status, "DRAFT"),
      metaX + 92,
      metaY + 55,
      {
        width: metaW - 104,
        align: "right",
        font: "Helvetica-Bold",
        size: 9.5,
        color: COLORS.ink,
        lineBreak: false,
      },
    );
  }

  return top + (continuation ? 80 : 106);
}

function drawSupplierAndDelivery(doc, purchaseOrder, y) {
  const left = PAGE.marginLeft;
  const right = PAGE.width - PAGE.marginRight;
  const gap = 16;
  const cardW = (right - left - gap) / 2;
  const cardH = 140;

  drawRoundedRect(
    doc,
    left,
    y,
    cardW,
    cardH,
    12,
    COLORS.soft,
    COLORS.softLine,
    1,
  );
  drawRoundedRect(
    doc,
    left + cardW + gap,
    y,
    cardW,
    cardH,
    12,
    COLORS.soft,
    COLORS.softLine,
    1,
  );

  sectionTitle(doc, "Supplier", left + 14, y + 12, cardW - 28);
  drawText(doc, purchaseOrder.supplierName, left + 14, y + 28, {
    width: cardW - 28,
    font: "Helvetica-Bold",
    size: 11,
    color: COLORS.ink,
  });

  const supplierContactName = safeTextSoft(
    purchaseOrder.supplierContactName,
    "-",
  );
  const supplierPhone = safeTextSoft(purchaseOrder.supplierPhone, "-");
  const supplierEmail = safeTextSoft(purchaseOrder.supplierEmail, "-");

  drawText(doc, "Contact person", left + 14, y + 50, {
    width: 90,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.muted,
  });
  drawText(doc, supplierContactName, left + 108, y + 50, {
    width: cardW - 122,
    font: "Helvetica",
    size: 9,
    color: COLORS.text,
    ellipsis: true,
  });

  drawText(doc, "Phone", left + 14, y + 68, {
    width: 90,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.muted,
  });
  drawText(doc, supplierPhone, left + 108, y + 68, {
    width: cardW - 122,
    font: "Helvetica",
    size: 9,
    color: COLORS.text,
    ellipsis: true,
  });

  drawText(doc, "Email", left + 14, y + 86, {
    width: 90,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.muted,
  });
  drawText(doc, supplierEmail, left + 108, y + 86, {
    width: cardW - 122,
    font: "Helvetica",
    size: 9,
    color: COLORS.text,
    ellipsis: true,
  });

  drawText(doc, purchaseOrder.supplierAddress || "-", left + 14, y + 108, {
    width: cardW - 28,
    font: "Helvetica",
    size: 8.8,
    color: COLORS.text,
    lineGap: 2,
  });

  sectionTitle(
    doc,
    "Purchase Order Info",
    left + cardW + gap + 14,
    y + 12,
    cardW - 28,
  );
  infoRow(
    doc,
    "Branch",
    `${purchaseOrder.locationName}${purchaseOrder.locationCode ? ` (${purchaseOrder.locationCode})` : ""}`,
    left + cardW + gap + 14,
    y + 30,
    cardW - 28,
    58,
  );
  infoRow(
    doc,
    "Reference",
    purchaseOrder.reference || "-",
    left + cardW + gap + 14,
    y + 50,
    cardW - 28,
    58,
  );
  infoRow(
    doc,
    "Expected",
    formatDate(purchaseOrder.expectedAt),
    left + cardW + gap + 14,
    y + 70,
    cardW - 28,
    58,
  );
  infoRow(
    doc,
    "Status",
    purchaseOrder.status,
    left + cardW + gap + 14,
    y + 90,
    cardW - 28,
    58,
  );

  return y + cardH + 18;
}

function getColumns() {
  return [
    { key: "itemNo", label: "#", x: 40, width: 34, align: "center" },
    {
      key: "item",
      label: "ITEM DESCRIPTION",
      x: 76,
      width: 274,
      align: "left",
    },
    { key: "qty", label: "QTY", x: 352, width: 52, align: "center" },
    { key: "price", label: "UNIT PRICE", x: 406, width: 72, align: "right" },
    { key: "total", label: "LINE TOTAL", x: 480, width: 76, align: "right" },
  ];
}

function drawTableHeader(doc, yTop) {
  const left = 40;
  const right = 556;
  const headerH = 24;
  const cols = getColumns();

  drawRoundedRect(doc, left, yTop, right - left, headerH, 8, COLORS.ink, null);

  cols.forEach((col) => {
    drawText(doc, col.label, col.x + (col.key === "item" ? 4 : 0), yTop + 7, {
      width: col.width - (col.key === "item" ? 4 : 0),
      align: col.align === "left" ? "left" : "center",
      font: "Helvetica-Bold",
      size: 8.5,
      color: COLORS.white,
    });
  });

  return {
    left,
    right,
    cols,
    contentY: yTop + headerH + 8,
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
      lineGap: 1,
    }),
  );

  const note = safeTextSoft(item.note, "");
  const noteH = note
    ? doc.heightOfString(`Note: ${note}`, {
        width: itemWidth,
        align: "left",
        lineGap: 1,
      }) + 8
    : 0;

  return {
    baseLine,
    note,
    height: Math.max(20, baseH + noteH + 7),
    baseH,
  };
}

function drawItemRow(doc, rowIndex, item, currency, layout, y) {
  const cols = layout.cols;
  const itemCol = cols.find((c) => c.key === "item");
  const qtyCol = cols.find((c) => c.key === "qty");
  const priceCol = cols.find((c) => c.key === "price");
  const totalCol = cols.find((c) => c.key === "total");

  const measured = measureItemBlock(doc, item, itemCol.width - 8);

  if (rowIndex % 2 === 0) {
    drawRoundedRect(
      doc,
      layout.left,
      y - 3,
      layout.right - layout.left,
      measured.height,
      6,
      COLORS.soft,
      null,
    );
  }

  drawText(doc, String(rowIndex + 1), cols[0].x, y + 2, {
    width: cols[0].width,
    align: "center",
    font: "Helvetica",
    size: 9,
    color: COLORS.text,
  });

  drawText(doc, measured.baseLine, itemCol.x, y + 1, {
    width: itemCol.width,
    align: "left",
    font: "Helvetica",
    size: 9,
    color: COLORS.ink,
    lineGap: 1,
  });

  drawText(doc, String(safeNumber(item.qtyOrdered, 0)), qtyCol.x, y + 2, {
    width: qtyCol.width,
    align: "center",
    font: "Helvetica",
    size: 9,
    color: COLORS.text,
  });

  drawText(doc, formatMoney(item.unitCost, currency), priceCol.x, y + 2, {
    width: priceCol.width,
    align: "right",
    font: "Helvetica",
    size: 9,
    color: COLORS.text,
  });

  drawText(doc, formatMoney(item.lineTotal, currency), totalCol.x, y + 2, {
    width: totalCol.width,
    align: "right",
    font: "Helvetica-Bold",
    size: 9.2,
    color: COLORS.ink,
  });

  if (measured.note) {
    drawText(doc, `Note: ${measured.note}`, itemCol.x, y + measured.baseH + 2, {
      width: itemCol.width,
      align: "left",
      font: "Helvetica-Oblique",
      size: 8,
      color: COLORS.muted,
      lineGap: 1,
    });
  }

  return measured.height;
}

function drawTotalsCard(doc, purchaseOrder, yTop) {
  const boxW = 214;
  const boxH = 76;
  const x = PAGE.width - PAGE.marginRight - boxW;

  drawRoundedRect(
    doc,
    x,
    yTop,
    boxW,
    boxH,
    12,
    COLORS.softCard,
    COLORS.softLine,
    1,
  );

  drawText(doc, "ORDER SUMMARY", x + 14, yTop + 11, {
    width: boxW - 28,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.muted,
  });

  drawLine(
    doc,
    x + 14,
    yTop + 26,
    x + boxW - 14,
    yTop + 26,
    COLORS.softLine,
    1,
  );

  drawText(doc, "Subtotal", x + 14, yTop + 35, {
    width: 70,
    font: "Helvetica",
    size: 9,
    color: COLORS.text,
  });
  drawText(
    doc,
    formatMoney(purchaseOrder.subtotalAmount, purchaseOrder.currency),
    x + 90,
    yTop + 34,
    {
      width: boxW - 104,
      align: "right",
      font: "Helvetica-Bold",
      size: 9.5,
      color: COLORS.ink,
    },
  );

  drawText(doc, "Total", x + 14, yTop + 55, {
    width: 70,
    font: "Helvetica-Bold",
    size: 10,
    color: COLORS.ink,
  });
  drawText(
    doc,
    formatMoney(purchaseOrder.totalAmount, purchaseOrder.currency),
    x + 90,
    yTop + 53,
    {
      width: boxW - 104,
      align: "right",
      font: "Helvetica-Bold",
      size: 11,
      color: COLORS.ink,
    },
  );

  return yTop + boxH;
}

function drawOptionalNotes(doc, purchaseOrder, yTop) {
  if (!hasMeaningfulNotes(purchaseOrder.notes)) {
    return yTop;
  }

  const x = PAGE.marginLeft;
  const w = PAGE.width - PAGE.marginLeft - PAGE.marginRight;

  sectionTitle(doc, "Special Instructions", x, yTop, w);

  const textY = yTop + 20;
  const textH = doc.heightOfString(purchaseOrder.notes, {
    width: w - 20,
    align: "left",
    lineGap: 2,
  });
  const boxH = Math.max(44, textH + 18);

  drawRoundedRect(doc, x, textY, w, boxH, 10, COLORS.soft, COLORS.softLine, 1);

  drawText(doc, purchaseOrder.notes, x + 10, textY + 9, {
    width: w - 20,
    font: "Helvetica",
    size: 9.2,
    color: COLORS.text,
    lineGap: 2,
  });

  return textY + boxH + 16;
}

function drawApprovalAndSignature(doc, purchaseOrder, yTop) {
  const x = PAGE.marginLeft;
  const w = PAGE.width - PAGE.marginLeft - PAGE.marginRight;

  sectionTitle(doc, "Approval & Authorization", x, yTop, w);

  const topY = yTop + 22;
  const gap = 16;
  const leftW = 248;
  const rightW = w - leftW - gap;
  const leftX = x;
  const rightX = x + leftW + gap;

  drawRoundedRect(
    doc,
    leftX,
    topY,
    leftW,
    96,
    12,
    COLORS.soft,
    COLORS.softLine,
    1,
  );
  drawRoundedRect(
    doc,
    rightX,
    topY,
    rightW,
    96,
    12,
    COLORS.soft,
    COLORS.softLine,
    1,
  );

  drawText(doc, "APPROVAL DETAILS", leftX + 12, topY + 10, {
    width: leftW - 24,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.muted,
  });

  infoRow(
    doc,
    "Created",
    joinParts(
      [purchaseOrder.createdByName, purchaseOrder.createdByEmail],
      " • ",
      "-",
    ),
    leftX + 12,
    topY + 30,
    leftW - 24,
    54,
  );
  infoRow(
    doc,
    "Approved",
    joinParts(
      [purchaseOrder.approvedByName, purchaseOrder.approvedByEmail],
      " • ",
      "-",
    ),
    leftX + 12,
    topY + 49,
    leftW - 24,
    54,
  );
  infoRow(
    doc,
    "Date",
    formatDate(purchaseOrder.approvedAt),
    leftX + 12,
    topY + 68,
    leftW - 24,
    54,
  );

  drawText(doc, "SIGNATURE & STAMP", rightX + 12, topY + 10, {
    width: rightW - 24,
    font: "Helvetica-Bold",
    size: 8.5,
    color: COLORS.muted,
  });

  drawText(doc, "Authorized signature", rightX + 12, topY + 34, {
    width: 120,
    font: "Helvetica",
    size: 8,
    color: COLORS.muted,
  });

  drawLine(
    doc,
    rightX + 12,
    topY + 64,
    rightX + 128,
    topY + 64,
    COLORS.lineDark,
    0.9,
  );

  drawText(doc, "Sign above", rightX + 12, topY + 68, {
    width: 120,
    font: "Helvetica-Oblique",
    size: 7.5,
    color: COLORS.lightText,
  });

  const stampBoxX = rightX + rightW - 112;
  const stampBoxY = topY + 28;
  const stampBoxW = 88;
  const stampBoxH = 46;

  drawRoundedRect(
    doc,
    stampBoxX,
    stampBoxY,
    stampBoxW,
    stampBoxH,
    10,
    null,
    COLORS.line,
    1,
  );

  drawText(doc, "Official stamp", stampBoxX, stampBoxY + 16, {
    width: stampBoxW,
    align: "center",
    font: "Helvetica-Oblique",
    size: 8.5,
    color: COLORS.muted,
  });

  return topY + 96;
}

function measureEndingSectionHeight(doc, purchaseOrder) {
  let h = 0;
  h += 76 + 18;

  if (hasMeaningfulNotes(purchaseOrder.notes)) {
    const notesH = doc.heightOfString(purchaseOrder.notes, {
      width: PAGE.width - PAGE.marginLeft - PAGE.marginRight - 20,
      align: "left",
      lineGap: 2,
    });
    h += 20 + Math.max(44, notesH + 18) + 16;
  }

  h += 22 + 96;
  return h;
}

function generatePurchaseOrderPdfBuffer({
  purchaseOrder,
  items,
  logoBuffer = null,
}) {
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

    const bottomLimit = PAGE.height - PAGE.marginBottom;
    const endingHeight = measureEndingSectionHeight(doc, purchaseOrder);

    let bodyStart = drawHeader(doc, purchaseOrder, false, logoBuffer);
    let nextY = drawSupplierAndDelivery(doc, purchaseOrder, bodyStart);

    drawText(doc, "ORDER LINES", PAGE.marginLeft, nextY, {
      width: PAGE.width - PAGE.marginLeft - PAGE.marginRight,
      align: "left",
      font: "Helvetica-Bold",
      size: 11,
      color: COLORS.ink,
    });

    let layout = drawTableHeader(doc, nextY + 18);
    let currentY = layout.contentY;
    let globalRowIndex = 0;

    for (let i = 0; i < items.length; i += 1) {
      const rowHeight = measureItemBlock(doc, items[i], 266).height;
      const isLastItem = i === items.length - 1;
      const reserve = isLastItem ? endingHeight + 16 : 0;

      if (currentY + rowHeight + reserve > bottomLimit) {
        doc.addPage();

        bodyStart = drawHeader(doc, purchaseOrder, true, logoBuffer);

        drawText(doc, "ORDER LINES", PAGE.marginLeft, bodyStart, {
          width: PAGE.width - PAGE.marginLeft - PAGE.marginRight,
          align: "left",
          font: "Helvetica-Bold",
          size: 11,
          color: COLORS.ink,
        });

        layout = drawTableHeader(doc, bodyStart + 18);
        currentY = layout.contentY;
      }

      const used = drawItemRow(
        doc,
        globalRowIndex,
        items[i],
        purchaseOrder.currency,
        layout,
        currentY,
      );
      currentY += used + 4;
      globalRowIndex += 1;
    }

    if (!items.length) {
      if (currentY + endingHeight > bottomLimit) {
        doc.addPage();
        bodyStart = drawHeader(doc, purchaseOrder, true, logoBuffer);
        currentY = bodyStart + 8;
      }

      drawRoundedRect(
        doc,
        PAGE.marginLeft,
        currentY,
        PAGE.width - PAGE.marginLeft - PAGE.marginRight,
        44,
        10,
        COLORS.soft,
        COLORS.softLine,
        1,
      );
      drawText(
        doc,
        "No items on this purchase order.",
        PAGE.marginLeft,
        currentY + 14,
        {
          width: PAGE.width - PAGE.marginLeft - PAGE.marginRight,
          align: "center",
          font: "Helvetica-Oblique",
          size: 10,
          color: COLORS.muted,
        },
      );
      currentY += 56;
    }

    if (currentY + endingHeight > bottomLimit) {
      doc.addPage();
      bodyStart = drawHeader(doc, purchaseOrder, true, logoBuffer);
      currentY = bodyStart + 6;
    }

    currentY = drawTotalsCard(doc, purchaseOrder, currentY + 8) + 14;
    currentY = drawOptionalNotes(doc, purchaseOrder, currentY);
    drawApprovalAndSignature(doc, purchaseOrder, currentY);

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

  const logoBuffer = await loadLogoBuffer(
    data?.purchaseOrder?.locationLogoUrl || "",
  );

  const buffer = await generatePurchaseOrderPdfBuffer({
    ...data,
    logoBuffer,
  });

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
