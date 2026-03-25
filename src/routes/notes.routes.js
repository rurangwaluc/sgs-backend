"use strict";

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");
const {
  createNote,
  listNotes,
  editNote,
  pinNote,
  resolveNote,
  deleteNote,
} = require("../controllers/notesController");

async function notesRoutes(app) {
  app.get(
    "/notes",
    { preHandler: [requirePermission(ACTIONS.NOTIFICATION_VIEW)] },
    listNotes,
  );

  app.post(
    "/notes",
    { preHandler: [requirePermission(ACTIONS.NOTIFICATION_VIEW)] },
    createNote,
  );

  app.patch(
    "/notes/:id",
    { preHandler: [requirePermission(ACTIONS.NOTIFICATION_VIEW)] },
    editNote,
  );

  app.patch(
    "/notes/:id/pin",
    { preHandler: [requirePermission(ACTIONS.NOTIFICATION_VIEW)] },
    pinNote,
  );

  app.patch(
    "/notes/:id/resolve",
    { preHandler: [requirePermission(ACTIONS.NOTIFICATION_VIEW)] },
    resolveNote,
  );

  app.delete(
    "/notes/:id",
    { preHandler: [requirePermission(ACTIONS.NOTIFICATION_VIEW)] },
    deleteNote,
  );
}

module.exports = { notesRoutes };
