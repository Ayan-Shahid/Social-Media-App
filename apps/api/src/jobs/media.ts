// media.uploaded -> process the original into public variants, then tell the owner.
import fs from "node:fs/promises";
import { UnrecoverableError, type Job } from "bullmq";
import { workerPool } from "../db/worker-pool.js";
import { BadMediaError, processImage, processVideo, publicDir, type Purpose } from "../media/pipeline.js";
import { publish } from "../infra/bus.js";
import { invalidate } from "../infra/cache.js";
import { keys } from "../infra/redis.js";
import type { EventMap } from "../infra/outbox.js";
import { mediaDto } from "../services/hydrate.js";

type Data = EventMap["media.uploaded"] & { eventId: string };

export async function mediaJob(job: Job<Data>) {
  const db = workerPool();
  const r = await db.query("select id, owner_id, kind, purpose, status, original_path from media where id = $1", [job.data.mediaId]);
  const m = r.rows[0];
  if (!m || m.status === "ready") return "skipped"; // deleted, or already done (idempotent)
  if (!m.original_path) throw new UnrecoverableError("Original missing");
  try {
    const out = m.kind === "image" ? await processImage(m.id, m.original_path, m.purpose as Purpose) : await processVideo(m.id, m.original_path, m.purpose as Purpose);
    await db.query(
      `update media set status = 'ready', error = null, variants = $2, width = $3, height = $4, duration_ms = $5, bytes = $6, mime = $7, original_path = null where id = $1`,
      [m.id, out.variants, out.width, out.height, out.durationMs, out.bytes, out.mime]);
    await fs.rm(m.original_path, { force: true });
    await afterChange(m.id, m.owner_id);
    return "ready";
  } catch (e) {
    if (e instanceof BadMediaError) {
      await markFailed(m.id, m.owner_id, e.message);
      throw new UnrecoverableError(e.message); // bad input: retrying won't help
    }
    throw e; // possibly temporary (e.g. out of memory): BullMQ retries with backoff
  }
}

export async function markFailed(mediaId: string, ownerId: string, message: string) {
  const db = workerPool();
  const r = await db.query("update media set status = 'failed', error = $2 where id = $1 and status <> 'ready' returning original_path", [mediaId, message]);
  if (r.rows[0]?.original_path) await fs.rm(r.rows[0].original_path, { force: true });
  await fs.rm(publicDir(mediaId), { recursive: true, force: true });
  await afterChange(mediaId, ownerId);
}

async function afterChange(mediaId: string, ownerId: string) {
  const db = workerPool();
  const r = await db.query("select id, kind, status, error, variants, file_name, poster_file_name, width, height, duration_ms from media where id = $1", [mediaId]);
  // Posts that use this media embed it in their cache entry; avatars are embedded in user entries.
  const posts = await db.query<{ post_id: string }>("select post_id from post_media where media_id = $1", [mediaId]);
  await invalidate(...posts.rows.map((p) => keys.post(p.post_id)), keys.user(ownerId));
  if (r.rows[0]) await publish([ownerId], "media:status", mediaDto(r.rows[0]));
}
