"use strict";

const { and, desc, eq, isNull, lt, or } = require("drizzle-orm");

const { db } = require("../config/db");
const { notes } = require("../db/schema/notes.schema");
const { users } = require("../db/schema/users.schema");
const { locations } = require("../db/schema/locations.schema");
const { safeLogAudit } = require("./auditService");
const AUDIT = require("../audit/actions");

const ALLOWED_ENTITY_TYPES = new Set(["sale", "credit", "customer"]);

function toNoteMessage(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  return s.slice(0, 2000);
}

function toInt(v, fallback = null) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toBool(v, fallback = false) {
  if (typeof v === "boolean") return v;
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "number") return v !== 0;

  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(s)) return true;
  if (["false", "0", "no", "n", "off"].includes(s)) return false;

  return fallback;
}

function toEntityType(v) {
  const s = String(v || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (!ALLOWED_ENTITY_TYPES.has(s)) return null;
  return s;
}

function mapNoteRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    locationId: row.locationId,
    userId: row.userId,

    entity: row.entity,
    entityType: row.entity,
    entityId: row.entityId,

    parentNoteId: row.parentNoteId ?? null,
    rootNoteId: row.rootNoteId ?? null,

    body: row.body,
    message: row.body,

    isPinned: !!row.isPinned,

    isResolved: !!row.isResolved,
    resolvedAt: row.resolvedAt ?? null,
    resolvedBy: row.resolvedBy ?? null,

    isDeleted: !!row.isDeleted,
    deletedAt: row.deletedAt ?? null,
    deletedBy: row.deletedBy ?? null,

    editedAt: row.editedAt ?? null,
    editedBy: row.editedBy ?? null,

    createdAt: row.createdAt,
    updatedAt: row.updatedAt,

    userName: row.userName || null,
    userEmail: row.userEmail || null,

    locationName: row.locationName || null,
    locationCode: row.locationCode || null,
    locationLabel:
      row?.locationName && row?.locationCode
        ? `${row.locationName} (${row.locationCode})`
        : row?.locationName ||
          (row?.locationId ? `Branch #${row.locationId}` : "-"),
  };
}

async function getHydratedNoteById(noteId) {
  const id = toInt(noteId, null);
  if (!id) return null;

  const rows = await db
    .select({
      id: notes.id,
      locationId: notes.locationId,
      userId: notes.userId,

      entity: notes.entity,
      entityId: notes.entityId,

      parentNoteId: notes.parentNoteId,
      rootNoteId: notes.rootNoteId,

      body: notes.body,
      isPinned: notes.isPinned,

      isResolved: notes.isResolved,
      resolvedAt: notes.resolvedAt,
      resolvedBy: notes.resolvedBy,

      isDeleted: notes.isDeleted,
      deletedAt: notes.deletedAt,
      deletedBy: notes.deletedBy,

      editedAt: notes.editedAt,
      editedBy: notes.editedBy,

      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,

      userName: users.name,
      userEmail: users.email,
      locationName: locations.name,
      locationCode: locations.code,
    })
    .from(notes)
    .leftJoin(users, eq(notes.userId, users.id))
    .leftJoin(locations, eq(notes.locationId, locations.id))
    .where(eq(notes.id, id))
    .limit(1);

  return mapNoteRow(rows[0] || null);
}

async function getNoteScope(noteId) {
  const id = toInt(noteId, null);
  if (!id) return null;

  const rows = await db
    .select({
      id: notes.id,
      locationId: notes.locationId,
      userId: notes.userId,
      entity: notes.entity,
      entityId: notes.entityId,
      parentNoteId: notes.parentNoteId,
      rootNoteId: notes.rootNoteId,
      isDeleted: notes.isDeleted,
      isResolved: notes.isResolved,
    })
    .from(notes)
    .where(eq(notes.id, id))
    .limit(1);

  return rows[0] || null;
}

async function createNote({
  locationId,
  userId,
  entityType,
  entityId,
  message,
  parentNoteId,
}) {
  const locId = toInt(locationId, null);
  const actorId = toInt(userId, null);
  const targetId = toInt(entityId, null);
  const replyToId = toInt(parentNoteId, null);
  const cleanMessage = toNoteMessage(message);
  const cleanEntityType = toEntityType(entityType);

  if (!locId) {
    const err = new Error("locationId is required");
    err.code = "BAD_LOCATION";
    throw err;
  }

  if (!actorId) {
    const err = new Error("userId is required");
    err.code = "BAD_USER";
    throw err;
  }

  if (!cleanEntityType) {
    const err = new Error("entityType is required");
    err.code = "BAD_ENTITY_TYPE";
    throw err;
  }

  if (!targetId) {
    const err = new Error("entityId is required");
    err.code = "BAD_ENTITY_ID";
    throw err;
  }

  if (!cleanMessage) {
    const err = new Error("Message is required");
    err.code = "BAD_MESSAGE";
    throw err;
  }

  const now = new Date();

  const createdId = await db.transaction(async (tx) => {
    let parent = null;

    if (replyToId) {
      const rows = await tx
        .select({
          id: notes.id,
          locationId: notes.locationId,
          entity: notes.entity,
          entityId: notes.entityId,
          rootNoteId: notes.rootNoteId,
          isDeleted: notes.isDeleted,
        })
        .from(notes)
        .where(eq(notes.id, replyToId))
        .limit(1);

      parent = rows[0] || null;

      if (!parent) {
        const err = new Error("Parent note not found");
        err.code = "BAD_PARENT_NOTE";
        throw err;
      }

      if (Number(parent.locationId) !== locId) {
        const err = new Error("Parent note is outside this location");
        err.code = "BAD_PARENT_NOTE";
        throw err;
      }

      if (String(parent.entity) !== cleanEntityType) {
        const err = new Error("Parent note entityType mismatch");
        err.code = "BAD_PARENT_NOTE";
        throw err;
      }

      if (Number(parent.entityId) !== targetId) {
        const err = new Error("Parent note entityId mismatch");
        err.code = "BAD_PARENT_NOTE";
        throw err;
      }

      if (parent.isDeleted) {
        const err = new Error("Cannot reply to a deleted note");
        err.code = "BAD_PARENT_NOTE";
        throw err;
      }
    }

    const [created] = await tx
      .insert(notes)
      .values({
        locationId: locId,
        userId: actorId,

        entity: cleanEntityType,
        entityId: targetId,

        parentNoteId: parent ? Number(parent.id) : null,
        rootNoteId: parent ? Number(parent.rootNoteId || parent.id) : null,

        body: cleanMessage,
        isPinned: false,

        isResolved: false,
        resolvedAt: null,
        resolvedBy: null,

        isDeleted: false,
        deletedAt: null,
        deletedBy: null,

        editedAt: null,
        editedBy: null,

        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: notes.id });

    if (!created?.id) {
      throw new Error("Failed to create note");
    }

    if (!parent) {
      await tx
        .update(notes)
        .set({
          rootNoteId: Number(created.id),
          updatedAt: now,
        })
        .where(eq(notes.id, Number(created.id)));
    }

    return Number(created.id);
  });

  const note = await getHydratedNoteById(createdId);

  await safeLogAudit({
    locationId: locId,
    userId: actorId,
    action: AUDIT.INTERNAL_NOTE_CREATED,
    entity: "note",
    entityId: createdId,
    description: replyToId
      ? `Reply added to ${cleanEntityType}#${targetId}`
      : `Note added to ${cleanEntityType}#${targetId}`,
    meta: {
      entityType: cleanEntityType,
      entityId: targetId,
      parentNoteId: replyToId || null,
      rootNoteId: note?.rootNoteId || createdId,
    },
  });

  return note;
}

async function listNotes({
  locationId,
  entityType,
  entityId,
  limit = 20,
  cursor,
  rootNoteId,
  parentNoteId,
  onlyRoot = false,
  includeDeleted = false,
  includeResolved = true,
}) {
  const locId = toInt(locationId, null);
  const targetId = toInt(entityId, null);
  const rootId = toInt(rootNoteId, null);
  const parentId = toInt(parentNoteId, null);
  const lim = Math.min(100, Math.max(1, Number(limit || 20)));
  const cursorId = toInt(cursor, null);
  const cleanEntityType = entityType ? toEntityType(entityType) : null;

  const where = [];

  if (locId) {
    where.push(eq(notes.locationId, locId));
  }

  if (cleanEntityType) {
    where.push(eq(notes.entity, cleanEntityType));
  }

  if (targetId) {
    where.push(eq(notes.entityId, targetId));
  }

  if (rootId) {
    where.push(eq(notes.rootNoteId, rootId));
  }

  if (parentId) {
    where.push(eq(notes.parentNoteId, parentId));
  }

  if (onlyRoot) {
    where.push(isNull(notes.parentNoteId));
  }

  if (!toBool(includeDeleted, false)) {
    where.push(eq(notes.isDeleted, false));
  }

  if (!toBool(includeResolved, true)) {
    where.push(eq(notes.isResolved, false));
  }

  if (cursorId) {
    where.push(lt(notes.id, cursorId));
  }

  const rows = await db
    .select({
      id: notes.id,
      locationId: notes.locationId,
      userId: notes.userId,

      entity: notes.entity,
      entityId: notes.entityId,

      parentNoteId: notes.parentNoteId,
      rootNoteId: notes.rootNoteId,

      body: notes.body,
      isPinned: notes.isPinned,

      isResolved: notes.isResolved,
      resolvedAt: notes.resolvedAt,
      resolvedBy: notes.resolvedBy,

      isDeleted: notes.isDeleted,
      deletedAt: notes.deletedAt,
      deletedBy: notes.deletedBy,

      editedAt: notes.editedAt,
      editedBy: notes.editedBy,

      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,

      userName: users.name,
      userEmail: users.email,
      locationName: locations.name,
      locationCode: locations.code,
    })
    .from(notes)
    .leftJoin(users, eq(notes.userId, users.id))
    .leftJoin(locations, eq(notes.locationId, locations.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(notes.isPinned), desc(notes.id))
    .limit(lim);

  const mapped = (rows || []).map(mapNoteRow);
  const nextCursor =
    mapped.length === lim ? mapped[mapped.length - 1].id : null;

  return {
    rows: mapped,
    nextCursor,
  };
}

async function editNote({ noteId, locationId, userId, message }) {
  const id = toInt(noteId, null);
  const locId = toInt(locationId, null);
  const actorId = toInt(userId, null);
  const cleanMessage = toNoteMessage(message);

  if (!id) {
    const err = new Error("noteId is required");
    err.code = "BAD_NOTE_ID";
    throw err;
  }

  if (!locId) {
    const err = new Error("locationId is required");
    err.code = "BAD_LOCATION";
    throw err;
  }

  if (!actorId) {
    const err = new Error("userId is required");
    err.code = "BAD_USER";
    throw err;
  }

  if (!cleanMessage) {
    const err = new Error("Message is required");
    err.code = "BAD_MESSAGE";
    throw err;
  }

  const scope = await getNoteScope(id);

  if (!scope || Number(scope.locationId) !== locId) {
    const err = new Error("Note not found");
    err.code = "NOTE_NOT_FOUND";
    throw err;
  }

  if (scope.isDeleted) {
    const err = new Error("Deleted note cannot be edited");
    err.code = "NOTE_DELETED";
    throw err;
  }

  const now = new Date();

  await db
    .update(notes)
    .set({
      body: cleanMessage,
      editedAt: now,
      editedBy: actorId,
      updatedAt: now,
    })
    .where(and(eq(notes.id, id), eq(notes.locationId, locId)));

  const note = await getHydratedNoteById(id);

  await safeLogAudit({
    locationId: locId,
    userId: actorId,
    action: AUDIT.INTERNAL_NOTE_EDITED,
    entity: "note",
    entityId: id,
    description: "Internal note edited",
    meta: {
      noteId: id,
      rootNoteId: note?.rootNoteId || null,
      entityType: note?.entityType || null,
      entityId: note?.entityId || null,
    },
  });

  return note;
}

async function pinNote({ noteId, locationId, userId, pinned = true }) {
  const id = toInt(noteId, null);
  const locId = toInt(locationId, null);
  const actorId = toInt(userId, null);

  if (!id) {
    const err = new Error("noteId is required");
    err.code = "BAD_NOTE_ID";
    throw err;
  }

  if (!locId) {
    const err = new Error("locationId is required");
    err.code = "BAD_LOCATION";
    throw err;
  }

  if (!actorId) {
    const err = new Error("userId is required");
    err.code = "BAD_USER";
    throw err;
  }

  const scope = await getNoteScope(id);

  if (!scope || Number(scope.locationId) !== locId) {
    const err = new Error("Note not found");
    err.code = "NOTE_NOT_FOUND";
    throw err;
  }

  if (scope.isDeleted) {
    const err = new Error("Deleted note cannot be pinned");
    err.code = "NOTE_DELETED";
    throw err;
  }

  const now = new Date();

  await db
    .update(notes)
    .set({
      isPinned: !!pinned,
      updatedAt: now,
    })
    .where(and(eq(notes.id, id), eq(notes.locationId, locId)));

  const note = await getHydratedNoteById(id);

  await safeLogAudit({
    locationId: locId,
    userId: actorId,
    action: pinned ? AUDIT.INTERNAL_NOTE_PINNED : AUDIT.INTERNAL_NOTE_UNPINNED,
    entity: "note",
    entityId: id,
    description: pinned ? "Internal note pinned" : "Internal note unpinned",
    meta: {
      noteId: id,
      rootNoteId: note?.rootNoteId || null,
      entityType: note?.entityType || null,
      entityId: note?.entityId || null,
    },
  });

  return note;
}

async function resolveNote({ noteId, locationId, userId, resolved = true }) {
  const id = toInt(noteId, null);
  const locId = toInt(locationId, null);
  const actorId = toInt(userId, null);

  if (!id) {
    const err = new Error("noteId is required");
    err.code = "BAD_NOTE_ID";
    throw err;
  }

  if (!locId) {
    const err = new Error("locationId is required");
    err.code = "BAD_LOCATION";
    throw err;
  }

  if (!actorId) {
    const err = new Error("userId is required");
    err.code = "BAD_USER";
    throw err;
  }

  const scope = await getNoteScope(id);

  if (!scope || Number(scope.locationId) !== locId) {
    const err = new Error("Note not found");
    err.code = "NOTE_NOT_FOUND";
    throw err;
  }

  if (scope.isDeleted) {
    const err = new Error("Deleted note cannot be resolved");
    err.code = "NOTE_DELETED";
    throw err;
  }

  const now = new Date();

  await db
    .update(notes)
    .set({
      isResolved: !!resolved,
      resolvedAt: resolved ? now : null,
      resolvedBy: resolved ? actorId : null,
      updatedAt: now,
    })
    .where(and(eq(notes.id, id), eq(notes.locationId, locId)));

  const note = await getHydratedNoteById(id);

  await safeLogAudit({
    locationId: locId,
    userId: actorId,
    action: resolved
      ? AUDIT.INTERNAL_NOTE_RESOLVED
      : AUDIT.INTERNAL_NOTE_REOPENED,
    entity: "note",
    entityId: id,
    description: resolved ? "Internal note resolved" : "Internal note reopened",
    meta: {
      noteId: id,
      rootNoteId: note?.rootNoteId || null,
      entityType: note?.entityType || null,
      entityId: note?.entityId || null,
    },
  });

  return note;
}

async function deleteNote({ noteId, locationId, userId }) {
  const id = toInt(noteId, null);
  const locId = toInt(locationId, null);
  const actorId = toInt(userId, null);

  if (!id) {
    const err = new Error("noteId is required");
    err.code = "BAD_NOTE_ID";
    throw err;
  }

  if (!locId) {
    const err = new Error("locationId is required");
    err.code = "BAD_LOCATION";
    throw err;
  }

  if (!actorId) {
    const err = new Error("userId is required");
    err.code = "BAD_USER";
    throw err;
  }

  const scope = await getNoteScope(id);

  if (!scope || Number(scope.locationId) !== locId) {
    const err = new Error("Note not found");
    err.code = "NOTE_NOT_FOUND";
    throw err;
  }

  if (scope.isDeleted) {
    return getHydratedNoteById(id);
  }

  const now = new Date();

  await db
    .update(notes)
    .set({
      isDeleted: true,
      deletedAt: now,
      deletedBy: actorId,
      updatedAt: now,
    })
    .where(and(eq(notes.id, id), eq(notes.locationId, locId)));

  const note = await getHydratedNoteById(id);

  await safeLogAudit({
    locationId: locId,
    userId: actorId,
    action: AUDIT.INTERNAL_NOTE_DELETED,
    entity: "note",
    entityId: id,
    description: "Internal note deleted",
    meta: {
      noteId: id,
      rootNoteId: note?.rootNoteId || null,
      entityType: note?.entityType || null,
      entityId: note?.entityId || null,
    },
  });

  return note;
}

module.exports = {
  createNote,
  listNotes,
  getHydratedNoteById,
  editNote,
  pinNote,
  resolveNote,
  deleteNote,
};
