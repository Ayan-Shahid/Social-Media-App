// Repeatable housekeeping jobs: expired stories, old outbox rows, abandoned uploads.
import type { Job } from "bullmq";
import { workerPool } from "../db/worker-pool.js";
import { BUCKETS, listObjects, removeObjectOrThrow, removePrefix } from "../infra/storage.js";
import { redis } from "../infra/redis.js";
import { publish } from "../infra/bus.js";

/** SQL: nothing uses media row `m` (no post, story or avatar). */
const UNUSED = `(not exists (select 1 from post_media pm where pm.media_id = m.id)
  and not exists (select 1 from stories s where s.media_id = m.id)
  and not exists (select 1 from users u where u.avatar_media_id = m.id))`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Files in both buckets whose media row doesn't exist. Keys: media/<id>/..., uploads/incoming/<user>/<id>. */
export async function reconcileStorage(minAgeMs: number) {
  const db = workerPool();
  const cutoff = Date.now() - minAgeMs;
  const byId = new Map<string, { bucket: string; prefix: string }>(); // media id -> where its files are
  let scanned = 0, unknown = 0, tooNew = 0;
  for await (const o of listObjects(BUCKETS.media)) {
    scanned++;
    const id = o.key.split("/")[0]!;
    if (!UUID.test(id)) { unknown++; continue; }
    if (o.modified.getTime() > cutoff) { tooNew++; continue; }
    byId.set(`m:${id}`, { bucket: BUCKETS.media, prefix: `${id}/` });
  }
  for await (const o of listObjects(BUCKETS.uploads, "incoming/")) {
    scanned++;
    const id = o.key.split("/")[2] ?? "";
    if (!UUID.test(id)) { unknown++; continue; }
    if (o.modified.getTime() > cutoff) { tooNew++; continue; }
    byId.set(`u:${id}`, { bucket: BUCKETS.uploads, prefix: o.key });
  }
  const ids = [...new Set([...byId.keys()].map((k) => k.slice(2)))];
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const r = await db.query<{ id: string }>("select id from media where id = any($1::uuid[])", [ids.slice(i, i + 1000)]);
    for (const x of r.rows) known.add(x.id);
  }
  let orphans = 0;
  for (const [k, where] of byId) {
    if (known.has(k.slice(2))) continue;
    await removePrefix(where.bucket, where.prefix);
    orphans++;
  }
  return { scanned, orphansDeleted: orphans, unknownKeys: unknown, skippedTooNew: tooNew };
}

export async function maintenanceJob(job: Job) {
  const db = workerPool();
  if (job.name === "stories.expire") {
    // Stories are already hidden by RLS after 24 h; this deletes them. Their media, if nothing else
    // uses it, is marked for deletion (media.abandoned removes the files, then the row).
    const r = await db.query<{ media_id: string }>("delete from stories where expires_at < now() - interval '1 hour' returning media_id");
    const ids = [...new Set(r.rows.map((s) => s.media_id))];
    if (ids.length) {
      await db.query(`
        update media m set status = 'deleting', deleting_since = now()
        where m.id = any($1::uuid[]) and m.status <> 'deleting' and ${UNUSED}`, [ids]);
    }
    return { deleted: r.rowCount };
  }
  if (job.name === "outbox.purge") {
    const r = await db.query("delete from outbox where published_at < now() - interval '3 days'");
    return { deleted: r.rowCount };
  }
  if (job.name === "media.abandoned") {
    // Two phases, so the database never forgets a file it hasn't deleted yet (DECISIONS.md D14):
    //  1. mark: uploads never used in a post/story/avatar within a day, and uploads never completed
    //     (signed URL expired after 10 minutes, browser closed...) after an hour -> status 'deleting'.
    //  2. purge, at least `graceMs` later: delete the files, THEN the row. If deleting files fails,
    //     the row stays 'deleting' and the next run tries again. Nothing can be attached meanwhile:
    //     only 'ready' media can go into a post, and that's checked again when the row is inserted.
    const graceMs = Number((job.data as { graceMs?: number } | undefined)?.graceMs ?? 10 * 60_000);
    const marked = await db.query(`
      update media m set status = 'deleting', deleting_since = now()
      where m.status <> 'deleting'
        and (m.created_at < now() - interval '1 day' or (m.status = 'uploading' and m.created_at < now() - interval '1 hour'))
        and ${UNUSED}`);
    const r = await db.query<{ id: string; original_path: string | null; variants: unknown }>(`
      select id, original_path, variants from media
      where status = 'deleting' and deleting_since <= now() - make_interval(secs => $1 / 1000.0)
      order by deleting_since limit 500`, [graceMs]);
    let deleted = 0, restored = 0, failed = 0;
    for (const m of r.rows) {
      // Belt and braces: if something did start using it, put it back instead of deleting it.
      const used = await db.query(`select 1 from media m where m.id = $1 and not ${UNUSED}`, [m.id]);
      if (used.rowCount) {
        await db.query("update media set status = $2, deleting_since = null where id = $1", [m.id, m.variants ? "ready" : "failed"]);
        restored++;
        continue;
      }
      try {
        await removePrefix(BUCKETS.media, `${m.id}/`);
        if (m.original_path) await removeObjectOrThrow(BUCKETS.uploads, m.original_path);
      } catch {
        failed++; // storage unreachable: keep the row, try next run
        continue;
      }
      await db.query("delete from media where id = $1 and status = 'deleting'", [m.id]);
      deleted++;
    }
    return { marked: marked.rowCount, deleted, restored, failed };
  }
  if (job.name === "storage.reconcile") {
    // Weekly safety net: anything in storage that the database doesn't know about (older than a day,
    // so in-flight uploads are left alone) is deleted. Catches whatever the rules above miss.
    const minAgeMs = Number((job.data as { minAgeMs?: number } | undefined)?.minAgeMs ?? 24 * 3600_000);
    const report = await reconcileStorage(minAgeMs);
    await redis.set("ops:storage-reconcile", JSON.stringify({ ...report, at: new Date().toISOString() }));
    return report;
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
