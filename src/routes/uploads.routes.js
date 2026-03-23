const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ACTIONS = require("../permissions/actions");
const { requirePermission } = require("../middleware/requirePermission");
const { safeLogAudit } = require("../services/auditService");
const AUDIT = require("../audit/actions");

const UPLOAD_BASE_DIR =
  process.env.UPLOAD_DIR && String(process.env.UPLOAD_DIR).trim()
    ? String(process.env.UPLOAD_DIR).trim()
    : path.join(process.cwd(), "uploads");

const ALLOWED_MIME_TO_EXT = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
});

const EXT_TO_CONTENT_TYPE = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
});

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_BASE_DIR)) {
    fs.mkdirSync(UPLOAD_BASE_DIR, { recursive: true });
  }
}

function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

function isSafeStoredFilename(name) {
  return /^[a-f0-9]{32}\.(jpg|png|webp|gif|pdf)$/i.test(String(name || ""));
}

function getFilePath(name) {
  return path.join(UPLOAD_BASE_DIR, name);
}

function isImageExt(ext) {
  return [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(
    String(ext || "").toLowerCase(),
  );
}

async function uploadsRoutes(app) {
  app.post(
    "/uploads",
    {
      preHandler: [requirePermission(ACTIONS.UPLOAD_CREATE)],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      ensureUploadDir();

      const parts = request.parts();
      const urls = [];
      const storedFiles = [];

      for await (const part of parts) {
        if (part.type !== "file") continue;

        const ext = ALLOWED_MIME_TO_EXT[part.mimetype];
        if (!ext) {
          part.file.resume();
          return reply.status(400).send({
            error: "Unsupported file type",
            debug: { mimetype: part.mimetype },
          });
        }

        const safeName = `${randomHex(16)}${ext}`;
        const filePath = getFilePath(safeName);

        await new Promise((resolve, reject) => {
          const ws = fs.createWriteStream(filePath, { flags: "wx" });
          part.file.on("error", reject);
          ws.on("error", reject);
          ws.on("finish", resolve);
          part.file.pipe(ws);
        });

        urls.push(`/uploads/${safeName}`);
        storedFiles.push(safeName);
      }

      if (urls.length === 0) {
        return reply.status(400).send({ error: "No files uploaded" });
      }

      await safeLogAudit({
        locationId: request.user?.locationId ?? null,
        userId: request.user?.id ?? null,
        action: AUDIT.UPLOAD_CREATE,
        entity: "upload",
        entityId: null,
        description: `Uploaded ${storedFiles.length} file(s)`,
        meta: { files: storedFiles },
      });

      return reply.send({ ok: true, urls });
    },
  );

  app.get("/uploads/:name", async (request, reply) => {
    ensureUploadDir();

    const name = String(request.params.name || "");
    if (!isSafeStoredFilename(name)) {
      return reply.status(400).send({ error: "Invalid file name" });
    }

    const filePath = getFilePath(name);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: "File not found" });
    }

    const ext = path.extname(name).toLowerCase();
    const contentType = EXT_TO_CONTENT_TYPE[ext] || "application/octet-stream";

    if (isImageExt(ext)) {
      reply.header(
        "Cache-Control",
        "public, max-age=300, stale-while-revalidate=86400",
      );
      reply.header("Content-Type", contentType);
      reply.header("Content-Disposition", "inline");
      return reply.send(fs.createReadStream(filePath));
    }

    await requirePermission(ACTIONS.UPLOAD_VIEW)(request, reply);

    await safeLogAudit({
      locationId: request.user?.locationId ?? null,
      userId: request.user?.id ?? null,
      action: AUDIT.UPLOAD_VIEW,
      entity: "upload",
      entityId: null,
      description: `Viewed upload ${name}`,
      meta: { file: name },
    });

    reply.header("Cache-Control", "private, max-age=3600");
    reply.header("Content-Type", contentType);
    reply.header("Content-Disposition", "inline");
    return reply.send(fs.createReadStream(filePath));
  });
}

module.exports = { uploadsRoutes };
