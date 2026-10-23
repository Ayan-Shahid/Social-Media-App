// Uploads (DECISIONS.md D8, D14). Three steps, and the API never carries the file bytes:
//   POST /api/media/uploads        declare type + size  -> media row ("uploading") + signed PUT URL
//   PUT  <signed URL>              browser -> object storage, directly
//   POST /api/media/:id/complete   API checks size + magic bytes, then a worker processes it
// The client hears the result over the realtime bus (media:status) or by polling GET /media/:id.
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asUser } from "../db/client.js";
import { media } from "../db/schema.js";
import { HttpError, notFound, parse, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { checkActual, checkDeclared, type Purpose } from "../media/pipeline.js";
import { emit } from "../infra/outbox.js";
import { BUCKETS, head, readHead, removeObject, signUpload } from "../infra/storage.js";
import { limit } from "../lib/limits.js";
import { mediaDto } from "../services/hydrate.js";

export const mediaRouter = Router();

const purposes = z.enum(["post", "avatar", "story", "short"]);
type Row = typeof media.$inferSelect;
const dto = (m: Row) => mediaDto({ ...m, file_name: m.fileName, poster_file_name: m.posterFileName, duration_ms: m.durationMs });

mediaRouter.post("/uploads", (req, _res, next) => { requireUser(req); next(); }, limit("upload"), idempotent, async (req, res) => {
  const me = requireUser(req);
  const body = parse(z.object({
    purpose: purposes.default("post"),
    mime: z.string().max(100),
    size: z.number().int().min(1),
  }), req.body);
  const kind = checkDeclared(body.mime, body.size, body.purpose as Purpose);
  const id = randomUUID();
  const key = `incoming/${me}/${id}`; // owner in the key: easy audits and per-user cleanup
  const [row] = await asUser(me, (tx) => tx.insert(media).values({
    id, ownerId: me, kind, purpose: body.purpose, status: "uploading", originalPath: key, mime: body.mime, bytes: body.size,
  }).returning());
  res.status(201).json({ media: dto(row!), upload: await signUpload(key, body.mime, body.size) });
});

mediaRouter.post("/:id/complete", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const [m] = await asUser(me, (tx) => tx.select().from(media).where(and(eq(media.id, id), eq(media.ownerId, me))));
  if (!m) throw notFound();
  if (m.status !== "uploading") return res.status(202).json({ media: dto(m) }); // already done: safe to repeat

  const obj = await head(BUCKETS.uploads, m.originalPath!);
  if (!obj) throw new HttpError(409, "The upload hasn't arrived yet. Try again.");
  const fail = async (e: unknown) => {
    await removeObject(BUCKETS.uploads, m.originalPath!);
    await asUser(me, (tx) => tx.update(media).set({ status: "failed", error: (e as Error).message, originalPath: null }).where(eq(media.id, id)));
    throw e;
  };
  // The signature already pins the size, but storage that ignores signed headers would let it slip.
  if (obj.size !== m.bytes) await fail(new HttpError(400, "The uploaded file isn't the size that was declared."));
  try { await checkActual(await readHead(BUCKETS.uploads, m.originalPath!), m.kind as "image" | "video", m.purpose as Purpose); }
  catch (e) { await fail(e); }

  // Status change + "media.uploaded" event in ONE transaction: the job can't be lost or run twice for nothing.
  const row = await asUser(me, async (tx) => {
    const [u] = await tx.update(media).set({ status: "processing" })
      .where(and(eq(media.id, id), sql`${media.status} = 'uploading'`)).returning();
    if (u) await emit(tx, me, "media.uploaded", { mediaId: id, ownerId: me, kind: u.kind as "image" | "video", purpose: u.purpose as Purpose });
    return u ?? (await tx.select().from(media).where(eq(media.id, id)))[0]!;
  });
  res.status(202).json({ media: dto(row) });
});

mediaRouter.get("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const [m] = await asUser(me, (tx) => tx.select().from(media).where(eq(media.id, id)));
  if (!m || m.ownerId !== me) throw notFound();
  res.json({ media: dto(m) });
});
