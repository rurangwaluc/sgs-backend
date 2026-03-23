"use strict";

const service = require("../services/inventoryAdjustRequestsService");

const {
  createInventoryAdjustRequestSchema,
  decideInventoryAdjustRequestSchema,
  listInventoryAdjustRequestsQuerySchema,
} = require("../validators/inventoryAdjustRequests.schema");

async function createAdjustRequest(request, reply) {
  const parsed = createInventoryAdjustRequestSchema.safeParse(
    request.body || {},
  );
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid payload",
      details: parsed.error.flatten(),
    });
  }

  try {
    const reqRow = await service.createRequest({
      locationId: request.user?.locationId,
      productId: parsed.data.productId,
      qtyChange: parsed.data.qtyChange,
      reason: parsed.data.reason,
      requestedByUserId: request.user?.id,
    });

    return reply.send({ ok: true, request: reqRow });
  } catch (e) {
    if (e.code === "BAD_PAYLOAD") {
      return reply.status(400).send({ error: e.message || "Invalid payload" });
    }

    if (e.code === "BAD_QTY_CHANGE") {
      return reply
        .status(400)
        .send({ error: e.message || "qtyChange must be a non-zero integer" });
    }

    request.log.error(e);
    return reply.status(500).send({
      error: e?.message || "Internal Server Error",
    });
  }
}

async function listAdjustRequests(request, reply) {
  const parsed = listInventoryAdjustRequestsQuerySchema.safeParse(
    request.query || {},
  );

  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
  }

  try {
    const requests = await service.listRequests({
      locationId: request.user?.locationId,
      role: request.user?.role,
      userId: request.user?.id,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    return reply.send({ ok: true, requests });
  } catch (e) {
    if (e.code === "BAD_CONTEXT") {
      return reply
        .status(400)
        .send({ error: e.message || "Missing locationId" });
    }

    request.log.error(e);
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function listMineAdjustRequests(request, reply) {
  const parsed = listInventoryAdjustRequestsQuerySchema.safeParse(
    request.query || {},
  );

  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid query",
      details: parsed.error.flatten(),
    });
  }

  try {
    const requests = await service.listRequests({
      locationId: request.user?.locationId,
      role: "store_keeper",
      userId: request.user?.id,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    return reply.send({ ok: true, requests });
  } catch (e) {
    if (e.code === "BAD_CONTEXT") {
      return reply
        .status(400)
        .send({ error: e.message || "Missing locationId" });
    }

    request.log.error(e);
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function approveAdjustRequest(request, reply) {
  const id = Number(request.params?.id);
  const parsed = decideInventoryAdjustRequestSchema.safeParse({ id });

  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid id" });
  }

  try {
    const updated = await service.approveRequest({
      id,
      locationId: request.user?.locationId,
      decidedByUserId: request.user?.id,
    });

    return reply.send({ ok: true, request: updated });
  } catch (e) {
    if (e.code === "BAD_PAYLOAD") {
      return reply.status(400).send({ error: e.message || "Invalid payload" });
    }

    if (e.code === "NOT_FOUND") {
      return reply.status(404).send({ error: "Request not found" });
    }

    if (e.code === "ALREADY_DECIDED") {
      return reply.status(409).send({ error: "Request already decided" });
    }

    request.log.error(e);
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

async function declineAdjustRequest(request, reply) {
  const id = Number(request.params?.id);
  const parsed = decideInventoryAdjustRequestSchema.safeParse({ id });

  if (!parsed.success) {
    return reply.status(400).send({ error: "Invalid id" });
  }

  try {
    const updated = await service.declineRequest({
      id,
      locationId: request.user?.locationId,
      decidedByUserId: request.user?.id,
    });

    return reply.send({ ok: true, request: updated });
  } catch (e) {
    if (e.code === "BAD_PAYLOAD") {
      return reply.status(400).send({ error: e.message || "Invalid payload" });
    }

    if (e.code === "NOT_FOUND") {
      return reply.status(404).send({ error: "Request not found" });
    }

    if (e.code === "ALREADY_DECIDED") {
      return reply.status(409).send({ error: "Request already decided" });
    }

    request.log.error(e);
    return reply.status(500).send({ error: "Internal Server Error" });
  }
}

module.exports = {
  createAdjustRequest,
  listAdjustRequests,
  listMineAdjustRequests,
  approveAdjustRequest,
  declineAdjustRequest,
};
