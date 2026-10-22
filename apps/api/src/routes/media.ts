// Uploads (DECISIONS.md D8). The request only checks the file and stores it; a worker processes it.
// The client gets the result over the realtime bus (media:status) or by polling GET /media/:id.
import { Router } from "express";
import multer from "multer";
import fs from "node:fs/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asUser } from "../db/client.js";
import { media } from "../db/schema.js";
import { badRequest, HttpError, notFound, parse, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { storeOriginal, validateUpload, type Purpose } from "../media/pipeline.js";
import { emit } from "../infra/outbox.js";
import { limiter } from "../lib/limits.js";
import { config } from "../config.js";
import { mediaDto } from "../services/hydrate.js";

export const mediaRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_VIDEO_MB * 1024 * 1024, files: 1, fields: 5, parts: 6 } });
const uploadLimiter = limiter("upload", 60 * 60_000, 120, "Upload limit reached. Try again later.", true);

function receive(req: Parameters<Parameters<typeof mediaRouter.post>[1]>[0], res: Parameters<Parameters<typeof mediaRouter.post>[1]>[1], next: (e?: unknown) => void) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(err.code === "LIMIT_FILE_SIZE" ? new HttpError(413, `File too large. Max ${config.MAX_VIDEO_MB} MB.`) : badRequest("Upload one file in the 'file' field."));
    }
    next(err);
  });
}

const purposes = z.enum(["post", "avatar", "story", "short"]);

mediaRouter.post("/", (req, _res, next) => { requireUser(req); next(); }, uploadLimiter, receive, idempotent, async (req, res) => {
  const me = requireUser(req);
  if (!req.file) throw badRequest("Choose a photo or video.");
  const purpose = parse(purposes.default("post"), req.query.purpose) as Purpose;
  const type = await validateUpload(req.file.buffer, purpose);
  const id = randomUUID();
  const originalPath = await storeOriginal(id, req.file.buffer);
  try {
    // Media row + "media.uploaded" event in ONE transaction: the job can't be lost or run for a rolled-back row.
    const row = await asUser(me, async (tx) => {
      const [m] = await tx.insert(media).values({ id, ownerId: me, kind: type.kind, purpose, status: "processing", originalPath, mime: type.mime, bytes: req.file!.size }).returning();
      await emit(tx, me, "media.uploaded", { mediaId: id, ownerId: me, kind: type.kind, purpose });
      return m!;
    });
    res.status(202).json({ media: mediaDto({ ...row, file_name: row.fileName, poster_file_name: row.posterFileName, duration_ms: row.durationMs }) });
  } catch (e) {
    await fs.rm(originalPath, { force: true });
    throw e;
  }
});

mediaRouter.get("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const [m] = await asUser(me, (tx) => tx.select().from(media).where(eq(media.id, id)));
  if (!m || m.ownerId !== me) throw notFound();
  res.json({ media: mediaDto({ ...m, file_name: m.fileName, poster_file_name: m.posterFileName, duration_ms: m.durationMs }) });
});
