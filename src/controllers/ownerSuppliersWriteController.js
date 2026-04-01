"use strict";

const {
  createOwnerSupplier,
  updateOwnerSupplier,
  deactivateOwnerSupplier,
  reactivateOwnerSupplier,
} = require("../services/ownerSuppliersService");

function toInt(v, def = null) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function cleanStr(v) {
  const s = v == null ? "" : String(v).trim();
  return s || null;
}

function getActorUser(request) {
  return {
    id: toInt(request.user?.id, null),
    locationId: toInt(request.user?.locationId, null),
    role: cleanStr(request.user?.role),
    name: cleanStr(request.user?.name),
    email: cleanStr(request.user?.email),
  };
}

function sendServiceError(request, reply, error, logMessage) {
  request.log.error({ err: error }, logMessage);

  const status = Number(error?.statusCode || 500);
  return reply.status(status).send({
    error: error?.message || "Internal Server Error",
  });
}

async function createOwnerSupplierHandler(request, reply) {
  try {
    const supplier = await createOwnerSupplier({
      actorUser: getActorUser(request),
      payload: request.body || {},
    });

    return reply.status(201).send({
      ok: true,
      supplier,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "createOwnerSupplierHandler failed",
    );
  }
}

async function updateOwnerSupplierHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier id" });
    }

    const supplier = await updateOwnerSupplier({
      id,
      actorUser: getActorUser(request),
      payload: request.body || {},
    });

    return reply.send({
      ok: true,
      supplier,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "updateOwnerSupplierHandler failed",
    );
  }
}

async function deactivateOwnerSupplierHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier id" });
    }

    const supplier = await deactivateOwnerSupplier({
      id,
      actorUser: getActorUser(request),
      reason: cleanStr(request.body?.reason),
    });

    return reply.send({
      ok: true,
      supplier,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "deactivateOwnerSupplierHandler failed",
    );
  }
}

async function reactivateOwnerSupplierHandler(request, reply) {
  try {
    const id = toInt(request.params?.id, null);
    if (!id || id <= 0) {
      return reply.status(400).send({ error: "Invalid supplier id" });
    }

    const supplier = await reactivateOwnerSupplier({
      id,
      actorUser: getActorUser(request),
    });

    return reply.send({
      ok: true,
      supplier,
    });
  } catch (error) {
    return sendServiceError(
      request,
      reply,
      error,
      "reactivateOwnerSupplierHandler failed",
    );
  }
}

module.exports = {
  createOwnerSupplier: createOwnerSupplierHandler,
  updateOwnerSupplier: updateOwnerSupplierHandler,
  deactivateOwnerSupplier: deactivateOwnerSupplierHandler,
  reactivateOwnerSupplier: reactivateOwnerSupplierHandler,
};
