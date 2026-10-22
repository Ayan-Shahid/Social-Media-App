// Repeatable housekeeping jobs: expired stories, old outbox rows, abandoned uploads.
import fs from "node:fs/promises";
import path from "node:path";
import type { Job } from "bullmq";
import { workerPool } from "../db/worker-pool.js";
import { config } from "../config.js";

export async function maintenanceJob(job: Job) {
  const db = workerPool();
  if (job.name === "stories.expire") {
    // Stories are already hidden by RLS after 24 h; this deletes them and frees their files.
    const r = await db.query<{ media_id: string }>("delete from stories where expires_at < now() - interval '1 hour' returning media_id");
    for (const s of r.rows) {
      const used = await db.query("select 1 from post_media where media_id = $1 union all select 1 from users where avatar_media_id = $1 limit 1", [s.media_id]);
      if (!used.rowCount) {
        await db.query("delete from media where id = $1", [s.media_id]).catch(() => {});
        await fs.rm(path.join(config.MEDIA_DIR, s.media_id), { recursive: true, force: true });
      }
    }
    return { deleted: r.rowCount };
  }
  if (job.name === "outbox.purge") {
    const r = await db.query("delete from outbox where published_at < now() - interval '3 days'");
    return { deleted: r.rowCount };
  }
  if (job.name === "media.abandoned") {
    // Uploads never used in a post/story/avatar within a day.
    const r = await db.query<{ id: string; original_path: string | null }>(`
      delete from media m where m.created_at < now() - interval '1 day'
        and not exists (select 1 from post_media pm where pm.media_id = m.id)
        and not exists (select 1 from stories s where s.media_id = m.id)
        and not exists (select 1 from users u where u.avatar_media_id = m.id)
      returning id, original_path`);
    for (const m of r.rows) {
      await fs.rm(path.join(config.MEDIA_DIR, m.id), { recursive: true, force: true });
      if (m.original_path) await fs.rm(m.original_path, { force: true });
    }
    return { deleted: r.rowCount };
  }
  return "ignored";
}
