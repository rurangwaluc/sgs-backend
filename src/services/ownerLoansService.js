"use strict";

const { and, desc, eq, ilike, or, sql, gte, lte } = require("drizzle-orm");

const { db } = require("../config/db");
const AUDIT = require("../audit/actions");
const { safeLogAudit } = require("./auditService");

const {
  ownerLoans,
  ownerLoanRepayments,
  OWNER_LOAN_RECEIVER_TYPES,
  OWNER_LOAN_METHODS,
  OWNER_LOAN_STATUSES,
} = require("../db/schema/owner_loans.schema");

const { customers } = require("../db/schema/customers.schema");
const { cashLedger } = require("../db/schema/cash_ledger.schema");

const {
  ownerLoanCreateSchema,
  ownerLoanUpdateSchema,
  ownerLoanRepaymentCreateSchema,
  ownerLoanVoidSchema,
} = require("../validators/ownerLoans.schema");

function toInt(v, def = null) {
  if (v === null || v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function moneyInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

function cleanDate(v) {
  const s = cleanStr(v);
  return s || null;
}

function normalizeCurrency(v, fallback = "RWF") {
  const s = String(v || fallback)
    .trim()
    .toUpperCase()
    .slice(0, 8);
  return s || fallback;
}

function normalizeMethod(v, fallback = "OTHER") {
  const s = String(v || fallback)
    .trim()
    .toUpperCase()
    .slice(0, 20);
  return OWNER_LOAN_METHODS.includes(s) ? s : fallback;
}

function normalizeReceiverType(v, fallback = "OTHER") {
  const s = String(v || fallback)
    .trim()
    .toUpperCase();
  return OWNER_LOAN_RECEIVER_TYPES.includes(s) ? s : fallback;
}

function normalizeStatus(v, fallback = "OPEN") {
  const s = String(v || fallback)
    .trim()
    .toUpperCase();
  return OWNER_LOAN_STATUSES.includes(s) ? s : fallback;
}

function normalizeRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase();
}

function isOwnerRole(actorUser) {
  return normalizeRole(actorUser?.role) === "owner";
}

function deriveLoanStatus({ principalAmount, repaidAmount, requestedStatus }) {
  const principal = moneyInt(principalAmount);
  const repaid = moneyInt(repaidAmount);
  const requested = String(requestedStatus || "")
    .trim()
    .toUpperCase();

  if (requested === "VOID") return "VOID";
  if (repaid <= 0) return "OPEN";
  if (repaid >= principal) return "REPAID";
  return "PARTIALLY_REPAID";
}

function buildLoanBalance(principalAmount, repaidAmount) {
  return Math.max(0, moneyInt(principalAmount) - moneyInt(repaidAmount));
}

function requireValidLocationId(locationId) {
  const lid = Number(locationId);
  if (!Number.isInteger(lid) || lid <= 0) {
    const err = new Error("Invalid location id");
    err.statusCode = 400;
    throw err;
  }
  return lid;
}

function requireValidLoanId(id) {
  const loanId = Number(id);
  if (!Number.isInteger(loanId) || loanId <= 0) {
    const err = new Error("Invalid owner loan id");
    err.statusCode = 400;
    throw err;
  }
  return loanId;
}

function resolveOwnerLoanScope({
  actorUser,
  locationId = null,
  payload = {},
  fallback = null,
} = {}) {
  const roleOwner = isOwnerRole(actorUser);

  const payloadLocationId = toInt(payload?.locationId, null);
  const explicitLocationId = toInt(locationId, null);
  const fallbackLocationId = toInt(fallback, null);
  const actorLocationId = toInt(actorUser?.locationId, null);

  const selectedLocationId =
    payloadLocationId ||
    explicitLocationId ||
    fallbackLocationId ||
    actorLocationId ||
    null;

  if (roleOwner) {
    return {
      isOwner: true,
      locationId:
        selectedLocationId && selectedLocationId > 0
          ? requireValidLocationId(selectedLocationId)
          : null,
    };
  }

  return {
    isOwner: false,
    locationId: requireValidLocationId(selectedLocationId),
  };
}

async function getCustomerOrThrow({ customerId, locationId, tx = db }) {
  const cid = toInt(customerId, null);
  const lid = requireValidLocationId(locationId);

  if (!cid || cid <= 0) {
    const err = new Error("Invalid customerId");
    err.statusCode = 400;
    throw err;
  }

  const selectedFields = {
    id: customers.id,
    name: customers.name,
    phone: customers.phone,
  };

  if (customers.email) {
    selectedFields.email = customers.email;
  }

  if (customers.locationId) {
    selectedFields.locationId = customers.locationId;
  }

  let query = tx.select(selectedFields).from(customers);

  if (customers.locationId) {
    query = query.where(
      and(eq(customers.id, cid), eq(customers.locationId, lid)),
    );
  } else {
    query = query.where(eq(customers.id, cid));
  }

  const [row] = await query.limit(1);

  if (!row) {
    const err = new Error("Customer not found");
    err.statusCode = 404;
    throw err;
  }

  return row;
}

async function getScopedLoanOrThrow({
  loanId,
  actorUser = null,
  locationId = null,
  tx = db,
}) {
  const id = requireValidLoanId(loanId);
  const scope = resolveOwnerLoanScope({
    actorUser,
    locationId,
  });

  const where = [eq(ownerLoans.id, id)];

  if (!scope.isOwner) {
    where.push(eq(ownerLoans.locationId, scope.locationId));
  } else if (scope.locationId) {
    where.push(eq(ownerLoans.locationId, scope.locationId));
  }

  const [row] = await tx
    .select()
    .from(ownerLoans)
    .where(and(...where));

  if (!row) {
    const err = new Error("Owner loan not found");
    err.statusCode = 404;
    throw err;
  }

  return row;
}

async function getAvailableBalanceForLocationMethod({
  locationId,
  method,
  tx = db,
}) {
  if (!cashLedger) return 0;

  const lid = requireValidLocationId(locationId);
  const normalizedMethod = normalizeMethod(method, "OTHER");

  const rows = await tx
    .select({
      balance: sql`
        COALESCE(
          SUM(
            CASE
              WHEN UPPER(COALESCE(${cashLedger.direction}, '')) = 'IN' THEN COALESCE(${cashLedger.amount}, 0)
              WHEN UPPER(COALESCE(${cashLedger.direction}, '')) = 'OUT' THEN -COALESCE(${cashLedger.amount}, 0)
              ELSE 0
            END
          ),
          0
        )::int
      `.as("balance"),
    })
    .from(cashLedger)
    .where(
      and(
        eq(cashLedger.locationId, lid),
        eq(cashLedger.method, normalizedMethod),
      ),
    );

  return Math.max(0, Number(rows?.[0]?.balance || 0));
}

async function assertEnoughAvailableBalance({
  locationId,
  method,
  amount,
  tx = db,
}) {
  const requestedAmount = moneyInt(amount);
  const availableBalance = await getAvailableBalanceForLocationMethod({
    locationId,
    method,
    tx,
  });

  if (requestedAmount > availableBalance) {
    const err = new Error(
      `Not enough ${String(method || "OTHER").toLowerCase()} balance in this branch. Available: ${availableBalance}. Requested: ${requestedAmount}.`,
    );
    err.statusCode = 409;
    err.meta = {
      code: "INSUFFICIENT_BRANCH_METHOD_BALANCE",
      availableBalance,
      requestedAmount,
      locationId,
      method: normalizeMethod(method, "OTHER"),
    };
    throw err;
  }

  return availableBalance;
}

async function createCashLedgerEntryIfPossible({
  tx,
  locationId,
  actorUser,
  amount,
  direction,
  method,
  note,
  reference,
}) {
  if (!cashLedger) return;

  const cashierId = actorUser?.id ? Number(actorUser.id) : null;
  if (!cashierId) {
    console.error("OWNER LOAN CASH LEDGER INSERT SKIPPED: missing cashierId", {
      locationId,
      amount,
      direction,
      method,
    });
    return;
  }

  try {
    await tx.insert(cashLedger).values({
      locationId: Number(locationId),
      cashierId,
      cashSessionId: null,
      type: "OWNER_LOAN",
      direction: String(direction || "OUT")
        .trim()
        .toUpperCase(),
      amount: moneyInt(amount),
      method: normalizeMethod(method, "OTHER"),
      reference: cleanStr(reference),
      saleId: null,
      paymentId: null,
      expenseId: null,
      creditId: null,
      creditPaymentId: null,
      note: cleanStr(note),
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("OWNER LOAN CASH LEDGER INSERT FAILED", {
      locationId,
      amount,
      direction,
      method,
      error: error?.message || error,
    });
  }
}

async function listOwnerLoans({
  actorUser = null,
  locationId = null,
  q,
  customerId,
  receiverType,
  status,
  dueFrom,
  dueTo,
  disbursedFrom,
  disbursedTo,
  limit = 50,
  offset = 0,
}) {
  const scope = resolveOwnerLoanScope({
    actorUser,
    locationId,
  });

  const lim = Math.max(1, Math.min(100, toInt(limit, 50) || 50));
  const off = Math.max(0, toInt(offset, 0) || 0);

  const where = [];

  if (!scope.isOwner) {
    where.push(eq(ownerLoans.locationId, scope.locationId));
  } else if (scope.locationId) {
    where.push(eq(ownerLoans.locationId, scope.locationId));
  }

  const search = cleanStr(q);
  if (search) {
    const like = `%${search}%`;
    where.push(
      or(
        ilike(ownerLoans.receiverName, like),
        ilike(ownerLoans.receiverPhone, like),
        ilike(ownerLoans.receiverEmail, like),
        ilike(ownerLoans.reference, like),
        ilike(ownerLoans.note, like),
        ilike(customers.name, like),
        sql`CAST(${ownerLoans.id} AS text) ILIKE ${like}`,
      ),
    );
  }

  const cid = toInt(customerId, null);
  if (cid) {
    where.push(eq(ownerLoans.customerId, cid));
  }

  if (receiverType) {
    where.push(
      eq(ownerLoans.receiverType, normalizeReceiverType(receiverType)),
    );
  }

  if (status) {
    where.push(eq(ownerLoans.status, normalizeStatus(status)));
  }

  if (dueFrom) {
    where.push(gte(ownerLoans.dueDate, cleanDate(dueFrom)));
  }

  if (dueTo) {
    where.push(lte(ownerLoans.dueDate, cleanDate(dueTo)));
  }

  if (disbursedFrom) {
    where.push(gte(ownerLoans.disbursedAt, cleanDate(disbursedFrom)));
  }

  if (disbursedTo) {
    where.push(lte(ownerLoans.disbursedAt, cleanDate(disbursedTo)));
  }

  const rows = await db
    .select({
      id: ownerLoans.id,
      locationId: ownerLoans.locationId,
      customerId: ownerLoans.customerId,
      receiverType: ownerLoans.receiverType,
      receiverName: ownerLoans.receiverName,
      receiverPhone: ownerLoans.receiverPhone,
      receiverEmail: ownerLoans.receiverEmail,
      principalAmount: ownerLoans.principalAmount,
      repaidAmount: ownerLoans.repaidAmount,
      balanceAmount:
        sql`GREATEST(${ownerLoans.principalAmount} - ${ownerLoans.repaidAmount}, 0)::int`.as(
          "balanceAmount",
        ),
      remainingAmount:
        sql`GREATEST(${ownerLoans.principalAmount} - ${ownerLoans.repaidAmount}, 0)::int`.as(
          "remainingAmount",
        ),
      currency: ownerLoans.currency,
      disbursementMethod: ownerLoans.disbursementMethod,
      reference: ownerLoans.reference,
      note: ownerLoans.note,
      status: ownerLoans.status,
      disbursedAt: ownerLoans.disbursedAt,
      dueDate: ownerLoans.dueDate,
      createdByUserId: ownerLoans.createdByUserId,
      createdAt: ownerLoans.createdAt,
      updatedAt: ownerLoans.updatedAt,
      customerName: customers.name,
      isOverdue: sql`
        CASE
          WHEN ${ownerLoans.dueDate} IS NOT NULL
           AND ${ownerLoans.dueDate} < CURRENT_DATE
           AND ${ownerLoans.status} NOT IN ('REPAID', 'VOID')
          THEN true
          ELSE false
        END
      `.as("isOverdue"),
      daysOverdue: sql`
        CASE
          WHEN ${ownerLoans.dueDate} IS NOT NULL
           AND ${ownerLoans.dueDate} < CURRENT_DATE
           AND ${ownerLoans.status} NOT IN ('REPAID', 'VOID')
          THEN (CURRENT_DATE - ${ownerLoans.dueDate})::int
          ELSE 0
        END
      `.as("daysOverdue"),
      repaymentsCount:
        sql`COALESCE((SELECT COUNT(*)::int FROM owner_loan_repayments r WHERE r.owner_loan_id = ${ownerLoans.id}), 0)`.as(
          "repaymentsCount",
        ),
    })
    .from(ownerLoans)
    .leftJoin(customers, eq(customers.id, ownerLoans.customerId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(ownerLoans.id))
    .limit(lim)
    .offset(off);

  return rows || [];
}

async function getOwnerLoan({ id, actorUser = null, locationId = null }) {
  const loanId = requireValidLoanId(id);
  const scope = resolveOwnerLoanScope({
    actorUser,
    locationId,
  });

  const selectedCustomerEmail = customers.email
    ? { customerEmail: customers.email }
    : {};

  const where = [eq(ownerLoans.id, loanId)];

  if (!scope.isOwner) {
    where.push(eq(ownerLoans.locationId, scope.locationId));
  } else if (scope.locationId) {
    where.push(eq(ownerLoans.locationId, scope.locationId));
  }

  const [loan] = await db
    .select({
      id: ownerLoans.id,
      locationId: ownerLoans.locationId,
      customerId: ownerLoans.customerId,
      receiverType: ownerLoans.receiverType,
      receiverName: ownerLoans.receiverName,
      receiverPhone: ownerLoans.receiverPhone,
      receiverEmail: ownerLoans.receiverEmail,
      principalAmount: ownerLoans.principalAmount,
      repaidAmount: ownerLoans.repaidAmount,
      balanceAmount:
        sql`GREATEST(${ownerLoans.principalAmount} - ${ownerLoans.repaidAmount}, 0)::int`.as(
          "balanceAmount",
        ),
      remainingAmount:
        sql`GREATEST(${ownerLoans.principalAmount} - ${ownerLoans.repaidAmount}, 0)::int`.as(
          "remainingAmount",
        ),
      currency: ownerLoans.currency,
      disbursementMethod: ownerLoans.disbursementMethod,
      reference: ownerLoans.reference,
      note: ownerLoans.note,
      status: ownerLoans.status,
      disbursedAt: ownerLoans.disbursedAt,
      dueDate: ownerLoans.dueDate,
      createdByUserId: ownerLoans.createdByUserId,
      createdAt: ownerLoans.createdAt,
      updatedAt: ownerLoans.updatedAt,
      customerName: customers.name,
      customerPhone: customers.phone,
      ...selectedCustomerEmail,
      isOverdue: sql`
        CASE
          WHEN ${ownerLoans.dueDate} IS NOT NULL
           AND ${ownerLoans.dueDate} < CURRENT_DATE
           AND ${ownerLoans.status} NOT IN ('REPAID', 'VOID')
          THEN true
          ELSE false
        END
      `.as("isOverdue"),
      daysOverdue: sql`
        CASE
          WHEN ${ownerLoans.dueDate} IS NOT NULL
           AND ${ownerLoans.dueDate} < CURRENT_DATE
           AND ${ownerLoans.status} NOT IN ('REPAID', 'VOID')
          THEN (CURRENT_DATE - ${ownerLoans.dueDate})::int
          ELSE 0
        END
      `.as("daysOverdue"),
    })
    .from(ownerLoans)
    .leftJoin(customers, eq(customers.id, ownerLoans.customerId))
    .where(and(...where));

  if (!loan) {
    const err = new Error("Owner loan not found");
    err.statusCode = 404;
    throw err;
  }

  const repaymentWhere = [eq(ownerLoanRepayments.ownerLoanId, loanId)];

  if (!scope.isOwner) {
    repaymentWhere.push(eq(ownerLoanRepayments.locationId, scope.locationId));
  } else if (scope.locationId) {
    repaymentWhere.push(eq(ownerLoanRepayments.locationId, scope.locationId));
  }

  const repayments = await db
    .select()
    .from(ownerLoanRepayments)
    .where(and(...repaymentWhere))
    .orderBy(desc(ownerLoanRepayments.id));

  return {
    loan,
    repayments: repayments || [],
  };
}

async function createOwnerLoan({ actorUser, payload }) {
  const parsed = ownerLoanCreateSchema.safeParse(payload || {});
  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const data = parsed.data;

  const scope = resolveOwnerLoanScope({
    actorUser,
    locationId: data.locationId,
  });

  const locationId = scope.locationId;
  requireValidLocationId(locationId);

  let customer = null;
  if (data.receiverType === "CUSTOMER") {
    customer = await getCustomerOrThrow({
      customerId: data.customerId,
      locationId,
    });
  }

  const principalAmount = moneyInt(data.principalAmount);
  if (!Number.isInteger(principalAmount) || principalAmount <= 0) {
    const err = new Error("principalAmount must be > 0");
    err.statusCode = 400;
    throw err;
  }

  const createdByUserId = actorUser?.id ? Number(actorUser.id) : null;
  const receiverType = normalizeReceiverType(data.receiverType, "OTHER");
  const disbursementMethod = normalizeMethod(data.disbursementMethod, "OTHER");

  const receiverName =
    receiverType === "CUSTOMER"
      ? cleanStr(customer?.name) || cleanStr(data.receiverName)
      : cleanStr(data.receiverName);

  const receiverPhone =
    receiverType === "CUSTOMER"
      ? cleanStr(customer?.phone) || cleanStr(data.receiverPhone)
      : cleanStr(data.receiverPhone);

  const receiverEmail =
    receiverType === "CUSTOMER"
      ? cleanStr(customer?.email) || cleanStr(data.receiverEmail)
      : cleanStr(data.receiverEmail);

  const status = deriveLoanStatus({
    principalAmount,
    repaidAmount: 0,
    requestedStatus: data.status,
  });

  const result = await db.transaction(async (tx) => {
    await assertEnoughAvailableBalance({
      locationId,
      method: disbursementMethod,
      amount: principalAmount,
      tx,
    });

    const [loan] = await tx
      .insert(ownerLoans)
      .values({
        locationId,
        customerId: receiverType === "CUSTOMER" ? Number(customer.id) : null,
        receiverType,
        receiverName,
        receiverPhone,
        receiverEmail,
        principalAmount,
        repaidAmount: 0,
        currency: normalizeCurrency(data.currency, "RWF"),
        disbursementMethod,
        reference: cleanStr(data.reference),
        note: cleanStr(data.note),
        status,
        disbursedAt: cleanDate(data.disbursedAt) || undefined,
        dueDate: cleanDate(data.dueDate),
        createdByUserId,
        updatedAt: sql`now()`,
      })
      .returning();

    await createCashLedgerEntryIfPossible({
      tx,
      locationId,
      actorUser,
      amount: principalAmount,
      direction: "OUT",
      method: loan.disbursementMethod,
      note: `Owner loan disbursed to ${receiverName || "receiver"}`,
      reference: loan.reference,
    });

    return loan;
  });

  await safeLogAudit({
    locationId,
    userId: createdByUserId,
    action: AUDIT.OWNER_LOAN_CREATE || "OWNER_LOAN_CREATE",
    entity: "owner_loan",
    entityId: result.id,
    description: `Created owner loan #${result.id}`,
    meta: {
      customerId: result.customerId,
      receiverType: result.receiverType,
      receiverName: result.receiverName,
      principalAmount: result.principalAmount,
      currency: result.currency,
      status: result.status,
      disbursementMethod: result.disbursementMethod,
    },
  });

  return result;
}

async function updateOwnerLoan({ id, actorUser, payload }) {
  const loanId = requireValidLoanId(id);
  const parsed = ownerLoanUpdateSchema.safeParse(payload || {});

  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const data = parsed.data;

  const existing = await getScopedLoanOrThrow({
    loanId,
    actorUser,
    locationId: data.locationId ?? actorUser?.locationId ?? null,
  });

  const currentStatus = normalizeStatus(existing.status, "OPEN");
  if (currentStatus === "REPAID" || currentStatus === "VOID") {
    const err = new Error(`Loan is ${currentStatus}; editing is locked.`);
    err.statusCode = 409;
    throw err;
  }

  const hasRepayments = Number(existing.repaidAmount || 0) > 0;
  const wantsStructuralChange =
    data.receiverType !== undefined ||
    data.customerId !== undefined ||
    data.receiverName !== undefined ||
    data.receiverPhone !== undefined ||
    data.receiverEmail !== undefined ||
    data.principalAmount !== undefined ||
    data.currency !== undefined ||
    data.disbursementMethod !== undefined ||
    data.disbursedAt !== undefined ||
    data.status !== undefined ||
    data.locationId !== undefined;

  if (hasRepayments && wantsStructuralChange) {
    const err = new Error(
      "Loan already has repayment history. Only due date, reference, and note can be changed now.",
    );
    err.statusCode = 409;
    throw err;
  }

  const nextLocationId =
    data.locationId !== undefined
      ? requireValidLocationId(data.locationId)
      : Number(existing.locationId);

  const nextReceiverType =
    data.receiverType !== undefined
      ? normalizeReceiverType(data.receiverType)
      : normalizeReceiverType(existing.receiverType);

  let nextCustomer = null;
  let nextCustomerId =
    data.customerId !== undefined
      ? toInt(data.customerId, null)
      : toInt(existing.customerId, null);

  if (nextReceiverType === "CUSTOMER") {
    nextCustomer = await getCustomerOrThrow({
      customerId: nextCustomerId,
      locationId: nextLocationId,
    });
    nextCustomerId = Number(nextCustomer.id);
  } else {
    nextCustomerId = null;
  }

  const nextPrincipalAmount =
    data.principalAmount !== undefined
      ? moneyInt(data.principalAmount)
      : moneyInt(existing.principalAmount);

  if (!Number.isInteger(nextPrincipalAmount) || nextPrincipalAmount <= 0) {
    const err = new Error("principalAmount must be > 0");
    err.statusCode = 400;
    throw err;
  }

  const nextDisbursementMethod =
    data.disbursementMethod !== undefined
      ? normalizeMethod(data.disbursementMethod, existing.disbursementMethod)
      : normalizeMethod(existing.disbursementMethod, "OTHER");

  const nextStatus =
    data.status !== undefined
      ? deriveLoanStatus({
          principalAmount: nextPrincipalAmount,
          repaidAmount: existing.repaidAmount,
          requestedStatus: data.status,
        })
      : undefined;

  const amountIncreased =
    nextPrincipalAmount > moneyInt(existing.principalAmount || 0);

  const methodChanged =
    nextDisbursementMethod !==
    normalizeMethod(existing.disbursementMethod, "OTHER");

  const locationChanged =
    Number(nextLocationId) !== Number(existing.locationId);

  if (!hasRepayments && (amountIncreased || methodChanged || locationChanged)) {
    await assertEnoughAvailableBalance({
      locationId: nextLocationId,
      method: nextDisbursementMethod,
      amount: nextPrincipalAmount,
    });
  }

  const [row] = await db
    .update(ownerLoans)
    .set({
      ...(data.locationId !== undefined ? { locationId: nextLocationId } : {}),
      ...(data.receiverType !== undefined
        ? { receiverType: nextReceiverType }
        : {}),
      ...(data.customerId !== undefined ||
      data.receiverType !== undefined ||
      data.locationId !== undefined
        ? { customerId: nextCustomerId }
        : {}),
      ...(data.receiverName !== undefined || nextReceiverType === "CUSTOMER"
        ? {
            receiverName:
              nextReceiverType === "CUSTOMER"
                ? cleanStr(nextCustomer?.name) ||
                  cleanStr(existing.receiverName)
                : cleanStr(data.receiverName),
          }
        : {}),
      ...(data.receiverPhone !== undefined || nextReceiverType === "CUSTOMER"
        ? {
            receiverPhone:
              nextReceiverType === "CUSTOMER"
                ? cleanStr(nextCustomer?.phone) ||
                  cleanStr(existing.receiverPhone)
                : cleanStr(data.receiverPhone),
          }
        : {}),
      ...(data.receiverEmail !== undefined || nextReceiverType === "CUSTOMER"
        ? {
            receiverEmail:
              nextReceiverType === "CUSTOMER"
                ? cleanStr(nextCustomer?.email) ||
                  cleanStr(existing.receiverEmail)
                : cleanStr(data.receiverEmail),
          }
        : {}),
      ...(data.principalAmount !== undefined
        ? { principalAmount: nextPrincipalAmount }
        : {}),
      ...(data.currency !== undefined
        ? {
            currency: normalizeCurrency(
              data.currency,
              existing.currency || "RWF",
            ),
          }
        : {}),
      ...(data.disbursementMethod !== undefined
        ? {
            disbursementMethod: nextDisbursementMethod,
          }
        : {}),
      ...(data.disbursedAt !== undefined
        ? { disbursedAt: cleanDate(data.disbursedAt) }
        : {}),
      ...(data.dueDate !== undefined
        ? { dueDate: cleanDate(data.dueDate) }
        : {}),
      ...(data.reference !== undefined
        ? { reference: cleanStr(data.reference) }
        : {}),
      ...(data.note !== undefined ? { note: cleanStr(data.note) } : {}),
      ...(nextStatus !== undefined ? { status: nextStatus } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(ownerLoans.id, loanId))
    .returning();

  if (!row) {
    const err = new Error("Owner loan not found");
    err.statusCode = 404;
    throw err;
  }

  await safeLogAudit({
    locationId: nextLocationId,
    userId: actorUser?.id || null,
    action: AUDIT.OWNER_LOAN_UPDATE || "OWNER_LOAN_UPDATE",
    entity: "owner_loan",
    entityId: row.id,
    description: `Updated owner loan #${row.id}`,
    meta: {
      customerId: row.customerId,
      receiverType: row.receiverType,
      receiverName: row.receiverName,
      principalAmount: row.principalAmount,
      repaidAmount: row.repaidAmount,
      status: row.status,
      disbursementMethod: row.disbursementMethod,
      locationId: row.locationId,
    },
  });

  return row;
}

async function createOwnerLoanRepayment({ id, actorUser, payload }) {
  const loanId = requireValidLoanId(id);
  const parsed = ownerLoanRepaymentCreateSchema.safeParse(payload || {});

  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const data = parsed.data;
  const amount = moneyInt(data.amount);

  if (!Number.isInteger(amount) || amount <= 0) {
    const err = new Error("Invalid amount");
    err.statusCode = 400;
    throw err;
  }

  const createdByUserId = actorUser?.id ? Number(actorUser.id) : null;

  const result = await db.transaction(async (tx) => {
    const loan = await getScopedLoanOrThrow({
      loanId,
      actorUser,
      locationId: data.locationId ?? actorUser?.locationId ?? null,
      tx,
    });

    const currentStatus = normalizeStatus(loan.status, "OPEN");

    if (currentStatus === "VOID") {
      const err = new Error("Loan is VOID");
      err.statusCode = 409;
      throw err;
    }

    if (currentStatus === "REPAID") {
      const err = new Error("Loan is already fully repaid");
      err.statusCode = 409;
      throw err;
    }

    const principalAmount = moneyInt(loan.principalAmount);
    const repaidAmount = moneyInt(loan.repaidAmount);
    const balanceAmount = buildLoanBalance(principalAmount, repaidAmount);

    if (amount > balanceAmount) {
      const err = new Error(`Repayment exceeds balance (${balanceAmount}).`);
      err.statusCode = 409;
      throw err;
    }

    const repaymentLocationId = Number(loan.locationId);

    const [repayment] = await tx
      .insert(ownerLoanRepayments)
      .values({
        locationId: repaymentLocationId,
        ownerLoanId: loanId,
        amount,
        method: normalizeMethod(data.method, "OTHER"),
        reference: cleanStr(data.reference),
        note: cleanStr(data.note),
        paidAt: cleanDate(data.paidAt) || undefined,
        createdByUserId,
      })
      .returning();

    const newRepaidAmount = repaidAmount + amount;
    const newStatus = deriveLoanStatus({
      principalAmount,
      repaidAmount: newRepaidAmount,
      requestedStatus: currentStatus,
    });

    await tx
      .update(ownerLoans)
      .set({
        repaidAmount: newRepaidAmount,
        status: newStatus,
        updatedAt: sql`now()`,
      })
      .where(eq(ownerLoans.id, loanId));

    await createCashLedgerEntryIfPossible({
      tx,
      locationId: repaymentLocationId,
      actorUser,
      amount,
      direction: "IN",
      method: repayment.method,
      note: `Owner loan repayment from ${loan.receiverName || "receiver"}`,
      reference: repayment.reference,
    });

    return {
      repayment,
      loan: {
        id: loanId,
        repaidAmount: newRepaidAmount,
        balanceAmount: buildLoanBalance(principalAmount, newRepaidAmount),
        remainingAmount: buildLoanBalance(principalAmount, newRepaidAmount),
        status: newStatus,
      },
      auditMeta: {
        customerId: loan.customerId,
        receiverType: loan.receiverType,
        receiverName: loan.receiverName,
        amount,
        newRepaidAmount,
        balanceAmount: buildLoanBalance(principalAmount, newRepaidAmount),
        status: newStatus,
      },
      locationId: repaymentLocationId,
    };
  });

  await safeLogAudit({
    locationId: result.locationId,
    userId: createdByUserId,
    action: AUDIT.OWNER_LOAN_REPAYMENT_CREATE || "OWNER_LOAN_REPAYMENT_CREATE",
    entity: "owner_loan",
    entityId: loanId,
    description: `Recorded repayment on owner loan #${loanId}`,
    meta: result.auditMeta,
  });

  return {
    repayment: result.repayment,
    loan: result.loan,
  };
}

async function voidOwnerLoan({ id, actorUser, payload }) {
  const loanId = requireValidLoanId(id);
  const parsed = ownerLoanVoidSchema.safeParse(payload || {});

  if (!parsed.success) {
    const err = new Error(
      parsed.error.issues?.[0]?.message || "Invalid payload",
    );
    err.statusCode = 400;
    throw err;
  }

  const data = parsed.data;

  const loan = await getScopedLoanOrThrow({
    loanId,
    actorUser,
    locationId: data.locationId ?? actorUser?.locationId ?? null,
  });

  if (moneyInt(loan.repaidAmount) > 0) {
    const err = new Error(
      "Loan already has repayment history. Void is blocked.",
    );
    err.statusCode = 409;
    throw err;
  }

  const [row] = await db
    .update(ownerLoans)
    .set({
      status: "VOID",
      note: cleanStr(
        [loan.note, `VOID REASON: ${cleanStr(data.reason)}`]
          .filter(Boolean)
          .join(" | "),
      ),
      updatedAt: sql`now()`,
    })
    .where(eq(ownerLoans.id, loanId))
    .returning();

  if (!row) {
    const err = new Error("Owner loan not found");
    err.statusCode = 404;
    throw err;
  }

  await safeLogAudit({
    locationId: row.locationId,
    userId: actorUser?.id || null,
    action: AUDIT.OWNER_LOAN_VOID || "OWNER_LOAN_VOID",
    entity: "owner_loan",
    entityId: row.id,
    description: `Voided owner loan #${row.id}`,
    meta: {
      receiverType: row.receiverType,
      receiverName: row.receiverName,
      principalAmount: row.principalAmount,
      status: row.status,
      reason: data.reason,
    },
  });

  return { loan: row };
}

async function ownerLoanSummary({
  actorUser = null,
  locationId = null,
  status,
  receiverType,
}) {
  const scope = resolveOwnerLoanScope({
    actorUser,
    locationId,
  });

  const where = [sql`${ownerLoans.status} <> 'VOID'`];

  if (!scope.isOwner) {
    where.push(eq(ownerLoans.locationId, scope.locationId));
  } else if (scope.locationId) {
    where.push(eq(ownerLoans.locationId, scope.locationId));
  }

  if (status) {
    where.push(eq(ownerLoans.status, normalizeStatus(status)));
  }

  if (receiverType) {
    where.push(
      eq(ownerLoans.receiverType, normalizeReceiverType(receiverType)),
    );
  }

  const rows = await db
    .select({
      loansCount: sql`count(*)::int`.as("loansCount"),
      totalPrincipalAmount:
        sql`coalesce(sum(${ownerLoans.principalAmount}), 0)::int`.as(
          "totalPrincipalAmount",
        ),
      totalRepaidAmount:
        sql`coalesce(sum(${ownerLoans.repaidAmount}), 0)::int`.as(
          "totalRepaidAmount",
        ),
      outstandingAmount:
        sql`coalesce(sum(greatest(${ownerLoans.principalAmount} - ${ownerLoans.repaidAmount}, 0)), 0)::int`.as(
          "outstandingAmount",
        ),
      openCount:
        sql`count(*) filter (where ${ownerLoans.status} = 'OPEN')::int`.as(
          "openCount",
        ),
      partialCount:
        sql`count(*) filter (where ${ownerLoans.status} = 'PARTIALLY_REPAID')::int`.as(
          "partialCount",
        ),
      repaidCount:
        sql`count(*) filter (where ${ownerLoans.status} = 'REPAID')::int`.as(
          "repaidCount",
        ),
      overdueCount: sql`count(*) filter (
        where ${ownerLoans.dueDate} is not null
          and ${ownerLoans.dueDate} < CURRENT_DATE
          and ${ownerLoans.status} not in ('REPAID', 'VOID')
      )::int`.as("overdueCount"),
      overdueAmount: sql`coalesce(sum(
        case
          when ${ownerLoans.dueDate} is not null
           and ${ownerLoans.dueDate} < CURRENT_DATE
           and ${ownerLoans.status} not in ('REPAID', 'VOID')
          then greatest(${ownerLoans.principalAmount} - ${ownerLoans.repaidAmount}, 0)
          else 0
        end
      ), 0)::int`.as("overdueAmount"),
    })
    .from(ownerLoans)
    .where(and(...where));

  const r = rows?.[0] || {
    loansCount: 0,
    totalPrincipalAmount: 0,
    totalRepaidAmount: 0,
    outstandingAmount: 0,
    openCount: 0,
    partialCount: 0,
    repaidCount: 0,
    overdueCount: 0,
    overdueAmount: 0,
  };

  const loansCount = Number(r.loansCount || 0);
  const totalPrincipalAmount = Number(r.totalPrincipalAmount || 0);
  const totalRepaidAmount = Number(r.totalRepaidAmount || 0);
  const outstandingAmount = Number(r.outstandingAmount || 0);
  const openCount = Number(r.openCount || 0);
  const partialCount = Number(r.partialCount || 0);
  const repaidCount = Number(r.repaidCount || 0);
  const overdueCount = Number(r.overdueCount || 0);
  const overdueAmount = Number(r.overdueAmount || 0);

  return {
    loansCount,
    totalPrincipalAmount,
    totalRepaidAmount,
    outstandingAmount,
    totalRemainingAmount: outstandingAmount,
    openCount,
    openLoansCount: openCount,
    partialCount,
    partiallyRepaidCount: partialCount,
    repaidCount,
    repaidLoansCount: repaidCount,
    overdueCount,
    overdueAmount,
  };
}

module.exports = {
  listOwnerLoans,
  getOwnerLoan,
  createOwnerLoan,
  updateOwnerLoan,
  createOwnerLoanRepayment,
  voidOwnerLoan,
  ownerLoanSummary,
};
