const crypto = require("crypto");

const { db } = require("../config/db");
const { sql } = require("drizzle-orm");

const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 1000;
const lastSeenWriteCache = new Map();

function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function readSignedSid(request) {
  const raw = request.cookies && request.cookies.sid;
  if (!raw) return null;

  if (typeof request.unsignCookie === "function") {
    const res = request.unsignCookie(raw);
    if (!res || res.valid !== true) return null;
    return res.value;
  }

  return raw;
}

function rowsOf(result) {
  return result?.rows || result || [];
}

function firstRow(result) {
  return rowsOf(result)[0] || null;
}

function shouldTouchLastSeen(userId, nowMs) {
  if (!userId) return false;

  const key = String(userId);
  const previous = lastSeenWriteCache.get(key) || 0;

  if (nowMs - previous < LAST_SEEN_WRITE_INTERVAL_MS) {
    return false;
  }

  lastSeenWriteCache.set(key, nowMs);
  return true;
}

function mapLocation(row) {
  if (!row || row.locationId == null) return null;

  return {
    id: row.locationId,
    name: row.locationName,
    code: row.locationCode,
    email: row.locationEmail ?? null,
    phone: row.locationPhone ?? null,
    website: row.locationWebsite ?? null,
    logoUrl: row.locationLogoUrl ?? null,
    address: row.locationAddress ?? null,
    tin: row.locationTin ?? null,
    momoCode: row.locationMomoCode ?? null,
    bankAccounts: Array.isArray(row.locationBankAccounts)
      ? row.locationBankAccounts
      : [],
    status: row.locationStatus ?? null,
    openedAt: row.locationOpenedAt ?? null,
    closedAt: row.locationClosedAt ?? null,
    archivedAt: row.locationArchivedAt ?? null,
    closeReason: row.locationCloseReason ?? null,
    updatedAt: row.locationUpdatedAt ?? null,
  };
}

async function loadSessionContext(tokenHash) {
  const result = await db.execute(sql`
    SELECT
      s.id AS "sessionId",
      s.user_id AS "sessionUserId",
      s.session_token AS "sessionToken",
      s.expires_at AS "sessionExpiresAt",
      s.acting_as_role AS "actingAsRole",
      s.coverage_reason AS "coverageReason",
      s.coverage_note AS "coverageNote",
      s.coverage_started_at AS "coverageStartedAt",
      s.created_at AS "sessionCreatedAt",

      u.id AS "userId",
      u.location_id AS "userLocationId",
      u.name AS "userName",
      u.email AS "userEmail",
      u.role AS "userRole",
      u.is_active AS "userIsActive",
      u.last_seen_at AS "userLastSeenAt",

      l.id AS "locationId",
      l.name AS "locationName",
      l.code AS "locationCode",
      l.email AS "locationEmail",
      l.phone AS "locationPhone",
      l.website AS "locationWebsite",
      l.logo_url AS "locationLogoUrl",
      l.address AS "locationAddress",
      l.tin AS "locationTin",
      l.momo_code AS "locationMomoCode",
      l.bank_accounts AS "locationBankAccounts",
      l.status AS "locationStatus",
      l.opened_at AS "locationOpenedAt",
      l.closed_at AS "locationClosedAt",
      l.archived_at AS "locationArchivedAt",
      l.close_reason AS "locationCloseReason",
      l.updated_at AS "locationUpdatedAt"
    FROM sessions s
    JOIN users u
      ON u.id = s.user_id
    LEFT JOIN locations l
      ON l.id = u.location_id
    WHERE s.session_token = ${tokenHash}
    LIMIT 1
  `);

  return firstRow(result);
}

async function touchLastSeen(request, userId, now) {
  const nowMs = now.getTime();

  if (!shouldTouchLastSeen(userId, nowMs)) {
    return;
  }

  try {
    await db.execute(sql`
      UPDATE users
      SET last_seen_at = ${now}
      WHERE id = ${userId}
    `);
  } catch (e) {
    lastSeenWriteCache.delete(String(userId));
    request.log?.warn?.({ err: e }, "lastSeenAt update failed");
  }
}

async function sessionAuth(request) {
  const tokenRaw = readSignedSid(request);

  if (!tokenRaw) {
    request.session = null;
    request.user = null;
    return;
  }

  const tokenHash = sha256Hex(tokenRaw);
  const now = new Date();

  const row = await loadSessionContext(tokenHash);

  if (!row || row.sessionExpiresAt <= now) {
    request.session = null;
    request.user = null;
    return;
  }

  if (row.userIsActive === false) {
    request.session = null;
    request.user = null;
    return;
  }

  const loc = mapLocation(row);

  request.session = {
    id: row.sessionId,
    userId: row.sessionUserId,
    expiresAt: row.sessionExpiresAt,
    actingAsRole: row.actingAsRole ?? null,
    coverageReason: row.coverageReason ?? null,
    coverageNote: row.coverageNote ?? null,
    coverageStartedAt: row.coverageStartedAt ?? null,
    createdAt: row.sessionCreatedAt ?? null,
  };

  request.user = {
    id: row.userId,
    locationId: row.userLocationId,
    name: row.userName,
    email: row.userEmail,
    role: row.userRole,
    isActive: row.userIsActive,
    lastSeenAt: now.toISOString(),

    location: loc,

    business: loc
      ? {
          name: loc.name,
          code: loc.code,
          email: loc.email ?? null,
          phone: loc.phone ?? null,
          website: loc.website ?? null,
          logoUrl: loc.logoUrl ?? null,
          address: loc.address ?? null,
          tin: loc.tin ?? null,
          momoCode: loc.momoCode ?? null,
          bankAccounts: Array.isArray(loc.bankAccounts) ? loc.bankAccounts : [],
        }
      : null,

    actingAsRole: row.actingAsRole ?? null,
    coverageReason: row.coverageReason ?? null,
    coverageNote: row.coverageNote ?? null,
    coverageStartedAt: row.coverageStartedAt ?? null,
  };

  await touchLastSeen(request, row.userId, now);
}

module.exports = { sessionAuth };
