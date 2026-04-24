"use strict";

const { db } = require("../config/db");
const { sql } = require("drizzle-orm");

const LOAN_STATUSES = {
  OPEN: "OPEN",
  PARTIALLY_REPAID: "PARTIALLY_REPAID",
  REPAID: "REPAID",
  VOID: "VOID",
};

const LENDER_TYPES = {
  CUSTOMER: "CUSTOMER",
  OTHER: "OTHER",
};

const METHODS = new Set(["CASH", "BANK", "MOMO", "CARD", "OTHER"]);

function rowsOf(result) {
  return result?.rows || result || [];
}

function firstRow(result, fallback = null) {
  const rows = rowsOf(result);
  return rows[0] || fallback;
}

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cleanStr(value, maxLen = null) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  return maxLen ? s.slice(0, maxLen) : s;
}

function cleanNullableStr(value, maxLen = null) {
  const s = cleanStr(value, maxLen);
  return s || null;
}

function normalizeMethod(value, fallback = "CASH") {
  const method = cleanStr(value).toUpperCase() || fallback;
  if (!METHODS.has(method)) {
    throw new Error("Invalid loan method");
  }
  return method;
}

function normalizeLenderType(value, customerId) {
  const raw = cleanStr(value).toUpperCase();
  if (raw === LENDER_TYPES.CUSTOMER) return LENDER_TYPES.CUSTOMER;
  if (customerId) return LENDER_TYPES.CUSTOMER;
  return LENDER_TYPES.OTHER;
}

function normalizeTimestamp(value, fieldLabel) {
  if (!value) return new Date();
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) {
    throw new Error(`Invalid ${fieldLabel}`);
  }
  return d;
}

function requirePositiveInt(value, fieldLabel) {
  const n = toInt(value, null);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${fieldLabel} must be greater than zero`);
  }
  return n;
}

function buildLoanStatus(principalAmount, repaidAmount) {
  if (repaidAmount <= 0) return LOAN_STATUSES.OPEN;
  if (repaidAmount >= principalAmount) return LOAN_STATUSES.REPAID;
  return LOAN_STATUSES.PARTIALLY_REPAID;
}

function mapLoanRow(row) {
  if (!row) return null;

  const principalAmount = toInt(row.principalAmount ?? row.principal_amount, 0);
  const repaidAmount = toInt(row.repaidAmount ?? row.repaid_amount, 0);
  const remainingAmount = Math.max(0, principalAmount - repaidAmount);

  return {
    id: toInt(row.id, null),
    locationId: toInt(row.locationId ?? row.location_id, null),
    locationName: cleanStr(row.locationName ?? row.location_name),
    locationCode: cleanStr(row.locationCode ?? row.location_code),
    lenderType: cleanStr(row.lenderType ?? row.lender_type),
    customerId: toInt(row.customerId ?? row.customer_id, null),
    lenderName: cleanStr(row.lenderName ?? row.lender_name),
    lenderPhone: cleanStr(row.lenderPhone ?? row.lender_phone),
    lenderEmail: cleanStr(row.lenderEmail ?? row.lender_email),
    principalAmount,
    repaidAmount,
    remainingAmount,
    currency: cleanStr(row.currency) || "RWF",
    receiptMethod: cleanStr(row.receiptMethod ?? row.receipt_method),
    receivedAt: row.receivedAt ?? row.received_at ?? null,
    dueDate: row.dueDate ?? row.due_date ?? null,
    reference: cleanStr(row.reference),
    note: cleanStr(row.note),
    status: cleanStr(row.status),
    createdByUserId: toInt(row.createdByUserId ?? row.created_by_user_id, null),
    voidedByUserId: toInt(row.voidedByUserId ?? row.voided_by_user_id, null),
    voidReason: cleanStr(row.voidReason ?? row.void_reason),
    voidedAt: row.voidedAt ?? row.voided_at ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  };
}

function mapRepaymentRow(row) {
  if (!row) return null;

  return {
    id: toInt(row.id, null),
    locationId: toInt(row.locationId ?? row.location_id, null),
    businessLoanId: toInt(row.businessLoanId ?? row.business_loan_id, null),
    amount: toInt(row.amount, 0),
    method: cleanStr(row.method),
    paidAt: row.paidAt ?? row.paid_at ?? null,
    reference: cleanStr(row.reference),
    note: cleanStr(row.note),
    createdByUserId: toInt(row.createdByUserId ?? row.created_by_user_id, null),
    createdAt: row.createdAt ?? row.created_at ?? null,
  };
}

function pad3(n) {
  return String(Number(n) || 0).padStart(3, "0");
}

function normalizeBranchCode(code, locationId) {
  const raw = cleanStr(code).toUpperCase();
  if (!raw) return "BRANCH";
  const normalized = raw.replace(/[^A-Z0-9]+/g, "");
  return normalized || `BRANCH${locationId}`;
}

function buildAutoReference({ locationCode, locationId, loanId }) {
  const code = normalizeBranchCode(locationCode, locationId);
  return `BLR-${code}-${pad3(loanId)}`;
}

async function createCashLedgerEntry(tx, payload) {
  const note = cleanNullableStr(payload.note, 500);
  const cashierId = toInt(payload.cashierId, null);

  if (!cashierId || cashierId <= 0) {
    throw new Error("Acting user is required for cash ledger entry");
  }

  const result = await tx.execute(sql`
    INSERT INTO cash_ledger (
      location_id,
      cashier_id,
      direction,
      type,
      method,
      amount,
      note,
      business_loan_received_id,
      business_loan_repayment_id
    )
    VALUES (
      ${payload.locationId},
      ${cashierId},
      ${payload.direction},
      ${payload.type},
      ${payload.method},
      ${payload.amount},
      ${note},
      ${payload.businessLoanReceivedId ?? null},
      ${payload.businessLoanRepaymentId ?? null}
    )
    RETURNING id
  `);

  return firstRow(result, null);
}

async function writeBusinessLoanAudit(_tx, _payload) {
  return null;
}

async function receiveBusinessLoan(input = {}, actor = {}) {
  const locationId = requirePositiveInt(input.locationId, "locationId");
  const principalAmount = requirePositiveInt(
    input.principalAmount,
    "principalAmount",
  );

  const createdByUserId = toInt(actor.userId ?? input.createdByUserId, null);
  if (!createdByUserId || createdByUserId <= 0) {
    throw new Error("Authenticated owner user is required");
  }

  const customerId = toInt(input.customerId, null);
  const lenderType = normalizeLenderType(input.lenderType, customerId);
  const lenderName = cleanStr(input.lenderName, 180);
  const lenderPhone = cleanNullableStr(input.lenderPhone, 40);
  const lenderEmail = cleanNullableStr(input.lenderEmail, 180);
  const receiptMethod = normalizeMethod(input.receiptMethod || input.method);
  const receivedAt = normalizeTimestamp(
    input.receivedAt || input.issueDate,
    "issueDate",
  );
  const dueDate = cleanNullableStr(input.dueDate, 10);
  const note = cleanNullableStr(input.note, 4000);

  if (!lenderName) {
    throw new Error("lenderName is required");
  }

  if (lenderType === LENDER_TYPES.CUSTOMER && !customerId) {
    throw new Error("customerId is required when lenderType is CUSTOMER");
  }

  return db.transaction(async (tx) => {
    if (customerId) {
      const customerExists = await tx.execute(sql`
        SELECT id
        FROM customers
        WHERE id = ${customerId}
        LIMIT 1
      `);

      if (!firstRow(customerExists)) {
        throw new Error("Customer not found");
      }
    }

    const locationRowRes = await tx.execute(sql`
      SELECT id, name, code
      FROM locations
      WHERE id = ${locationId}
      LIMIT 1
    `);

    const locationRow = firstRow(locationRowRes);
    if (!locationRow) {
      throw new Error("Location not found");
    }

    const insertedLoanRes = await tx.execute(sql`
      INSERT INTO business_loans_received (
        location_id,
        lender_type,
        customer_id,
        lender_name,
        lender_phone,
        lender_email,
        principal_amount,
        repaid_amount,
        currency,
        receipt_method,
        received_at,
        due_date,
        reference,
        note,
        status,
        created_by_user_id
      )
      VALUES (
        ${locationId},
        ${lenderType},
        ${customerId},
        ${lenderName},
        ${lenderPhone},
        ${lenderEmail},
        ${principalAmount},
        ${0},
        ${"RWF"},
        ${receiptMethod},
        ${receivedAt},
        ${dueDate},
        ${null},
        ${note},
        ${LOAN_STATUSES.OPEN},
        ${createdByUserId}
      )
      RETURNING *
    `);

    const insertedLoanRaw = firstRow(insertedLoanRes);
    if (!insertedLoanRaw?.id) {
      throw new Error("Failed to create received business loan");
    }

    const finalReference = buildAutoReference({
      locationCode: locationRow.code,
      locationId,
      loanId: insertedLoanRaw.id,
    });

    const updatedLoanRes = await tx.execute(sql`
      UPDATE business_loans_received
      SET
        reference = ${finalReference},
        updated_at = now()
      WHERE id = ${insertedLoanRaw.id}
      RETURNING *
    `);

    const finalLoanRow = firstRow(updatedLoanRes) || insertedLoanRaw;

    const insertedLoan = mapLoanRow({
      ...finalLoanRow,
      location_name: locationRow.name,
      location_code: locationRow.code,
    });

    await createCashLedgerEntry(tx, {
      locationId,
      cashierId: createdByUserId,
      direction: "IN",
      type: "BUSINESS_LOAN_RECEIVED",
      method: receiptMethod,
      amount: principalAmount,
      note:
        cleanNullableStr(
          `Business loan received from ${lenderName} • Ref ${finalReference}`,
          500,
        ) || null,
      businessLoanReceivedId: insertedLoan.id,
      businessLoanRepaymentId: null,
    });

    await writeBusinessLoanAudit(tx, {
      action: "BUSINESS_LOAN_RECEIVED_CREATED",
      actorUserId: createdByUserId,
      locationId,
      entity: "business_loan_received",
      entityId: insertedLoan.id,
      detail: {
        lenderType,
        customerId,
        lenderName,
        principalAmount,
        receiptMethod,
        reference: finalReference,
      },
    });

    return insertedLoan;
  });
}

async function repayBusinessLoan(input = {}, actor = {}) {
  const businessLoanId = requirePositiveInt(
    input.businessLoanId || input.loanId,
    "businessLoanId",
  );
  const amount = requirePositiveInt(input.amount, "amount");
  const method = normalizeMethod(input.method);
  const paidAt = normalizeTimestamp(input.paidAt, "paidAt");
  const note = cleanNullableStr(input.note, 300);
  const createdByUserId = toInt(actor.userId ?? input.createdByUserId, null);

  if (!createdByUserId || createdByUserId <= 0) {
    throw new Error("Authenticated owner user is required");
  }

  return db.transaction(async (tx) => {
    const loanRes = await tx.execute(sql`
      SELECT blr.*, l.name as location_name, l.code as location_code
      FROM business_loans_received blr
      LEFT JOIN locations l ON l.id = blr.location_id
      WHERE blr.id = ${businessLoanId}
      FOR UPDATE
    `);

    const currentLoan = mapLoanRow(firstRow(loanRes));
    if (!currentLoan?.id) {
      throw new Error("Business loan not found");
    }

    if (currentLoan.status === LOAN_STATUSES.VOID) {
      throw new Error("Void business loan cannot be repaid");
    }

    if (currentLoan.status === LOAN_STATUSES.REPAID) {
      throw new Error("Business loan is already fully repaid");
    }

    const remainingBefore = Math.max(
      0,
      currentLoan.principalAmount - currentLoan.repaidAmount,
    );

    if (amount > remainingBefore) {
      throw new Error("Repayment amount exceeds remaining balance");
    }

    const repaymentReference = `BLRP-${normalizeBranchCode(
      currentLoan.locationCode,
      currentLoan.locationId,
    )}-${pad3(currentLoan.id)}-${Date.now()}`;

    const insertedRepaymentRes = await tx.execute(sql`
      INSERT INTO business_loan_repayments (
        location_id,
        business_loan_id,
        amount,
        method,
        paid_at,
        reference,
        note,
        created_by_user_id
      )
      VALUES (
        ${currentLoan.locationId},
        ${businessLoanId},
        ${amount},
        ${method},
        ${paidAt},
        ${repaymentReference},
        ${note},
        ${createdByUserId}
      )
      RETURNING *
    `);

    const insertedRepayment = mapRepaymentRow(firstRow(insertedRepaymentRes));
    if (!insertedRepayment?.id) {
      throw new Error("Failed to create business loan repayment");
    }

    const newRepaidAmount = currentLoan.repaidAmount + amount;
    const newStatus = buildLoanStatus(
      currentLoan.principalAmount,
      newRepaidAmount,
    );

    const updatedLoanRes = await tx.execute(sql`
      UPDATE business_loans_received
      SET
        repaid_amount = ${newRepaidAmount},
        status = ${newStatus},
        updated_at = now()
      WHERE id = ${businessLoanId}
      RETURNING *
    `);

    const updatedLoan = mapLoanRow({
      ...(firstRow(updatedLoanRes) || {}),
      location_name: currentLoan.locationName,
      location_code: currentLoan.locationCode,
    });

    if (!updatedLoan?.id) {
      throw new Error("Failed to update business loan after repayment");
    }

    await createCashLedgerEntry(tx, {
      locationId: currentLoan.locationId,
      cashierId: createdByUserId,
      direction: "OUT",
      type: "BUSINESS_LOAN_REPAYMENT",
      method,
      amount,
      note:
        cleanNullableStr(
          `Business loan repayment to ${currentLoan.lenderName} • Ref ${repaymentReference}`,
          500,
        ) || null,
      businessLoanReceivedId: currentLoan.id,
      businessLoanRepaymentId: insertedRepayment.id,
    });

    await writeBusinessLoanAudit(tx, {
      action: "BUSINESS_LOAN_REPAYMENT_CREATED",
      actorUserId: createdByUserId,
      locationId: currentLoan.locationId,
      entity: "business_loan_received",
      entityId: currentLoan.id,
      detail: {
        repaymentId: insertedRepayment.id,
        amount,
        method,
        remainingAfter: updatedLoan.remainingAmount,
        statusAfter: updatedLoan.status,
        reference: repaymentReference,
      },
    });

    return {
      repayment: insertedRepayment,
      loan: updatedLoan,
    };
  });
}

async function listBusinessLoansReceived(filters = {}) {
  const locationId = toInt(filters.locationId, null);
  const status = cleanStr(filters.status).toUpperCase();
  const q = cleanStr(filters.q).toLowerCase();
  const limit = Math.min(Math.max(toInt(filters.limit, 50) || 50, 1), 200);

  const result = await db.execute(sql`
    SELECT
      blr.*,
      c.name AS customer_name,
      l.name AS location_name,
      l.code AS location_code,
      (
        SELECT COUNT(*)::int
        FROM business_loan_repayments blrp
        WHERE blrp.business_loan_id = blr.id
      ) AS "repaymentsCount"
    FROM business_loans_received blr
    LEFT JOIN customers c ON c.id = blr.customer_id
    LEFT JOIN locations l ON l.id = blr.location_id
    WHERE 1 = 1
      ${locationId ? sql`AND blr.location_id = ${locationId}` : sql``}
      ${status ? sql`AND UPPER(blr.status) = ${status}` : sql``}
      ${
        q
          ? sql`
            AND (
              LOWER(COALESCE(blr.lender_name, '')) LIKE ${`%${q}%`}
              OR LOWER(COALESCE(blr.lender_phone, '')) LIKE ${`%${q}%`}
              OR LOWER(COALESCE(blr.reference, '')) LIKE ${`%${q}%`}
              OR CAST(blr.id AS TEXT) LIKE ${`%${q}%`}
              OR LOWER(COALESCE(c.name, '')) LIKE ${`%${q}%`}
              OR LOWER(COALESCE(l.name, '')) LIKE ${`%${q}%`}
              OR LOWER(COALESCE(l.code, '')) LIKE ${`%${q}%`}
            )
          `
          : sql``
      }
    ORDER BY blr.received_at DESC, blr.id DESC
    LIMIT ${limit}
  `);

  return rowsOf(result).map(mapLoanRow);
}

async function getBusinessLoanReceivedById(id) {
  const businessLoanId = requirePositiveInt(id, "businessLoanId");

  const loanRes = await db.execute(sql`
    SELECT
      blr.*,
      l.name AS location_name,
      l.code AS location_code
    FROM business_loans_received blr
    LEFT JOIN locations l ON l.id = blr.location_id
    WHERE blr.id = ${businessLoanId}
    LIMIT 1
  `);

  const loan = mapLoanRow(firstRow(loanRes));
  if (!loan) return null;

  const repaymentsRes = await db.execute(sql`
    SELECT *
    FROM business_loan_repayments
    WHERE business_loan_id = ${businessLoanId}
    ORDER BY paid_at DESC, id DESC
  `);

  return {
    loan,
    repayments: rowsOf(repaymentsRes).map(mapRepaymentRow),
  };
}

async function getBusinessLoansReceivedSummary(filters = {}) {
  const locationId = toInt(filters.locationId, null);

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS "loansCount",
      COALESCE(SUM(principal_amount), 0)::bigint AS "principalTotal",
      COALESCE(SUM(repaid_amount), 0)::bigint AS "repaidTotal",
      COALESCE(SUM(principal_amount - repaid_amount), 0)::bigint AS "remainingTotal",
      COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0)::int AS "openCount",
      COALESCE(SUM(CASE WHEN status = 'PARTIALLY_REPAID' THEN 1 ELSE 0 END), 0)::int AS "partiallyRepaidCount",
      COALESCE(SUM(CASE WHEN status = 'REPAID' THEN 1 ELSE 0 END), 0)::int AS "repaidCount",
      COALESCE(SUM(CASE WHEN status = 'VOID' THEN 1 ELSE 0 END), 0)::int AS "voidCount"
    FROM business_loans_received
    WHERE 1 = 1
      ${locationId ? sql`AND location_id = ${locationId}` : sql``}
  `);

  const row = firstRow(result, {});

  return {
    loansCount: toInt(row.loansCount, 0),
    principalTotal: toInt(row.principalTotal, 0),
    repaidTotal: toInt(row.repaidTotal, 0),
    remainingTotal: toInt(row.remainingTotal, 0),
    openCount: toInt(row.openCount, 0),
    partiallyRepaidCount: toInt(row.partiallyRepaidCount, 0),
    repaidCount: toInt(row.repaidCount, 0),
    voidCount: toInt(row.voidCount, 0),
  };
}

module.exports = {
  receiveBusinessLoan,
  repayBusinessLoan,
  listBusinessLoansReceived,
  getBusinessLoanReceivedById,
  getBusinessLoansReceivedSummary,
};
