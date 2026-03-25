"use strict";

const {
  createNoteSchema,
  listNotesSchema,
  editNoteSchema,
  pinNoteSchema,
  resolveNoteSchema,
} = require("../validators/notes.schema");
const notesService = require("../services/notesService");

function requireUser(request, reply) {
  if (!request.user) {
    reply.status(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

function isOwner(user) {
  return (
    String(user?.role || "")
      .trim()
      .toLowerCase() === "owner"
  );
}

function getEffectiveLocationId(request, requestedLocationId) {
  return isOwner(request.user)
    ? (requestedLocationId ?? null)
    : request.user.locationId;
}

function sendBadRequest(reply, parsed, fallback = "Invalid payload") {
  return reply.status(400).send({
    error: fallback,
    details: parsed.error.flatten(),
  });
}

function handleServiceError(request, reply, e, logMessage) {
  request.log.error({ err: e }, logMessage);

  if (
    e.code === "BAD_MESSAGE" ||
    e.code === "BAD_LOCATION" ||
    e.code === "BAD_USER" ||
    e.code === "BAD_ENTITY_TYPE" ||
    e.code === "BAD_ENTITY_ID" ||
    e.code === "BAD_NOTE_ID" ||
    e.code === "BAD_PARENT_NOTE_ID" ||
    e.code === "BAD_ROOT_NOTE_ID" ||
    e.code === "BAD_PIN_STATE" ||
    e.code === "BAD_RESOLVE_STATE" ||
    e.code === "BAD_DELETE_STATE"
  ) {
    return reply.status(400).send({ error: e.message });
  }

  if (
    e.code === "NOTE_NOT_FOUND" ||
    e.code === "PARENT_NOTE_NOT_FOUND" ||
    e.code === "ROOT_NOTE_NOT_FOUND"
  ) {
    return reply.status(404).send({ error: e.message });
  }

  if (
    e.code === "NOTE_ACCESS_DENIED" ||
    e.code === "NOTE_LOCATION_MISMATCH" ||
    e.code === "NOTE_ENTITY_MISMATCH" ||
    e.code === "NOTE_EDIT_FORBIDDEN" ||
    e.code === "NOTE_DELETE_FORBIDDEN" ||
    e.code === "NOTE_PIN_FORBIDDEN" ||
    e.code === "NOTE_RESOLVE_FORBIDDEN"
  ) {
    return reply.status(403).send({ error: e.message });
  }

  return reply.status(500).send({ error: "Internal Server Error" });
}

async function createNote(request, reply) {
  if (!requireUser(request, reply)) return;

  const parsed = createNoteSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return sendBadRequest(reply, parsed);
  }

  try {
    const note = await notesService.createNote({
      locationId: request.user.locationId,
      userId: request.user.id,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      message: parsed.data.message,
      parentNoteId: parsed.data.parentNoteId ?? null,
    });

    return reply.send({
      ok: true,
      note,
    });
  } catch (e) {
    return handleServiceError(request, reply, e, "createNote failed");
  }
}

async function listNotes(request, reply) {
  if (!requireUser(request, reply)) return;

  const parsed = listNotesSchema.safeParse(request.query || {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
  }

  try {
    const effectiveLocationId = getEffectiveLocationId(
      request,
      parsed.data.locationId,
    );

    const out = await notesService.listNotes({
      locationId: effectiveLocationId,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      rootNoteId: parsed.data.rootNoteId ?? null,
      parentNoteId: parsed.data.parentNoteId ?? null,
      onlyRoot: parsed.data.onlyRoot,
      includeDeleted: parsed.data.includeDeleted,
      includeResolved: parsed.data.includeResolved,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor,
    });

    return reply.send({
      ok: true,
      rows: out.rows,
      nextCursor: out.nextCursor,
    });
  } catch (e) {
    return handleServiceError(request, reply, e, "listNotes failed");
  }
}

async function editNote(request, reply) {
  if (!requireUser(request, reply)) return;

  const noteId = Number(request.params?.id);
  if (!Number.isFinite(noteId) || noteId <= 0) {
    return reply.status(400).send({ error: "Invalid note id" });
  }

  const parsed = editNoteSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return sendBadRequest(reply, parsed);
  }

  try {
    const note = await notesService.editNote({
      noteId,
      actorUserId: request.user.id,
      actorRole: request.user.role,
      actorLocationId: request.user.locationId,
      message: parsed.data.message,
      ownerMode: isOwner(request.user),
    });

    return reply.send({
      ok: true,
      note,
    });
  } catch (e) {
    return handleServiceError(request, reply, e, "editNote failed");
  }
}

async function pinNote(request, reply) {
  if (!requireUser(request, reply)) return;

  const noteId = Number(request.params?.id);
  if (!Number.isFinite(noteId) || noteId <= 0) {
    return reply.status(400).send({ error: "Invalid note id" });
  }

  const parsed = pinNoteSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return sendBadRequest(reply, parsed);
  }

  try {
    const note = await notesService.setPinnedState({
      noteId,
      actorUserId: request.user.id,
      actorRole: request.user.role,
      actorLocationId: request.user.locationId,
      pinned: parsed.data.pinned,
      ownerMode: isOwner(request.user),
    });

    return reply.send({
      ok: true,
      note,
    });
  } catch (e) {
    return handleServiceError(request, reply, e, "pinNote failed");
  }
}

async function resolveNote(request, reply) {
  if (!requireUser(request, reply)) return;

  const noteId = Number(request.params?.id);
  if (!Number.isFinite(noteId) || noteId <= 0) {
    return reply.status(400).send({ error: "Invalid note id" });
  }

  const parsed = resolveNoteSchema.safeParse(request.body || {});
  if (!parsed.success) {
    return sendBadRequest(reply, parsed);
  }

  try {
    const note = await notesService.setResolvedState({
      noteId,
      actorUserId: request.user.id,
      actorRole: request.user.role,
      actorLocationId: request.user.locationId,
      resolved: parsed.data.resolved,
      ownerMode: isOwner(request.user),
    });

    return reply.send({
      ok: true,
      note,
    });
  } catch (e) {
    return handleServiceError(request, reply, e, "resolveNote failed");
  }
}

async function deleteNote(request, reply) {
  if (!requireUser(request, reply)) return;

  const noteId = Number(request.params?.id);
  if (!Number.isFinite(noteId) || noteId <= 0) {
    return reply.status(400).send({ error: "Invalid note id" });
  }

  try {
    const note = await notesService.softDeleteNote({
      noteId,
      actorUserId: request.user.id,
      actorRole: request.user.role,
      actorLocationId: request.user.locationId,
      ownerMode: isOwner(request.user),
    });

    return reply.send({
      ok: true,
      note,
    });
  } catch (e) {
    return handleServiceError(request, reply, e, "deleteNote failed");
  }
}

module.exports = {
  createNote,
  listNotes,
  editNote,
  pinNote,
  resolveNote,
  deleteNote,
};
