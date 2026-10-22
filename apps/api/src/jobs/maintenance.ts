// Repeatable housekeeping jobs: expired stories, old outbox rows, abandoned uploads.
import type { Job } from "bullmq";
import { workerPool } from "../db/worker-pool.js";
import { BUCKETS, removeObject, removePrefix } from "../infra/storage.js";
import { redis } from "../infra/redis.js";
import { publish } from "../infra/bus.js";

export async function maintenanceJob(job: Job) {
  const db = workerPool();
  if (job.name === "stories.expire") {
    // Stories are already hidden by RLS after 24 h; this deletes them and frees their files.
    const r = await db.query<{ media_id: string }>("delete from stories where expires_at < now() - interval '1 hour' returning media_id");
    for (const s of r.rows) {
      const used = await db.query("select 1 from post_media where media_id = $1 union all select 1 from users where avatar_media_id = $1 limit 1", [s.media_id]);
      if (!used.rowCount) {
        await db.query("delete from media where id = $1", [s.media_id]).catch(() => {});
        await removePrefix(BUCKETS.media, `${s.media_id}/`);
      }
    }
    return { deleted: r.rowCount };
  }
  if (job.name === "outbox.purge") {
    const r = await db.query("delete from outbox where published_at < now() - interval '3 days'");
    return { deleted: r.rowCount };
  }
  if (job.name === "media.abandoned") {
    // Uploads never used in a post/story/avatar within a day, and uploads that were never completed
    // (signed URL expired after 10 minutes, browser closed...) after an hour.
    const r = await db.query<{ id: string; original_path: string | null }>(`
      delete from media m where (m.created_at < now() - interval '1 day' or (m.status = 'uploading' and m.created_at < now() - interval '1 hour'))
        and not exists (select 1 from post_media pm where pm.media_id = m.id)
        and not exists (select 1 from stories s where s.media_id = m.id)
        and not exists (select 1 from users u where u.avatar_media_id = m.id)
      returning id, original_path`);
    for (const m of r.rows) {
      await removePrefix(BUCKETS.media, `${m.id}/`);
      if (m.original_path) await removeObject(BUCKETS.uploads, m.original_path);
    }
    return { deleted: r.rowCount };
  }
  if (job.name === "live.reap") {
    // Crash recovery: the live service refreshes live:<id>:alive every 5 s while ingesting. A stream whose
    // key is gone (process crashed, container restarted) or that never got going is ended here.
    const r = await db.query<{ id: string; status: string; created_at: Date }>("select id, status, created_at from live_streams where status <> 'ended'");
    let ended = 0;
    for (const s of r.rows) {
      const alive = await redis.exists(`live:${s.id}:alive`);
      const stale = s.status === "live" ? !alive : !alive && Date.now() - s.created_at.getTime() > 2 * 60_000;
      if (!stale) continue;
      await db.query("update live_streams set status = 'ended', ended_at = now() where id = $1 and status <> 'ended'", [s.id]);
      await publish([`#live:${s.id}`], "live:ended", { id: s.id });
      ended++;
    }
    return { ended };
  }
  return "ignored";
}
