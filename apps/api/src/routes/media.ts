import { Router } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import fs from "node:fs/promises";
import path from "node:path";
import { asUser } from "../db/client.js";
import { media } from "../db/schema.js";
import { badRequest, HttpError, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { sanitizeUpload } from "../media/sanitize.js";
import { config } from "../config.js";

export const mediaRouter = Router();

// Kept in memory (never written under the user's file name), one file, hard size cap.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_VIDEO_MB * 1024 * 1024, files: 1, fields: 5, parts: 6 },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60_000, limit: 60, keyGenerator: (req) => req.userId ?? "anon",
  standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Upload limit reached. Try again later." },
});

function receive(req: Parameters<Parameters<typeof mediaRouter.post>[1]>[0], res: Parameters<Parameters<typeof mediaRouter.post>[1]>[1], next: (e?: unknown) => void) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(err.code === "LIMIT_FILE_SIZE" ? new HttpError(413, `File too large. Max ${config.MAX_VIDEO_MB} MB.`) : badRequest("Upload one file in the 'file' field."));
    }
    next(err);
  });
}

mediaRouter.post("/", uploadLimiter, (req, _res, next) => { requireUser(req); next(); }, receive, idempotent, async (req, res) => {
  const me = requireUser(req);
  const file = req.file;
  if (!file) throw badRequest("Choose a photo or video.");
  const purpose = req.query.purpose === "avatar" ? "avatar" : "post";
  const clean = await sanitizeUpload(file.buffer, purpose);
  try {
    const [row] = await asUser(me, (tx) => tx.insert(media).values({ ownerId: me, ...clean }).returning());
    res.status(201).json({
      media: { id: row!.id, kind: row!.kind, url: `/media/${row!.fileName}`, posterUrl: row!.posterFileName ? `/media/${row!.posterFileName}` : null, width: row!.width, height: row!.height },
    });
  } catch (e) {
    await fs.rm(path.join(config.MEDIA_DIR, clean.fileName), { force: true });
    if (clean.posterFileName) await fs.rm(path.join(config.MEDIA_DIR, clean.posterFileName), { force: true });
    throw e;
  }
});
