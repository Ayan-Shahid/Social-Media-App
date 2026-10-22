// Live video control plane (DECISIONS.md D16). The video goes through the live service; these routes
// manage the record: start, list who's live, details, end.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { asUser } from "../db/client.js";
import { notFound, parse, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { publish } from "../infra/bus.js";
import { redis } from "../infra/redis.js";
import { getUsers } from "../services/hydrate.js";

export const liveRouter = Router();

type Row = { id: string; host_id: string; title: string; status: string; started_at: string | null; created_at: string; ended_at: string | null; peak_viewers: number };

async function viewers(id: string) {
  return redis.zcount(`live:${id}:viewers`, Date.now() - 30_000, "+inf").catch(() => 0);
}

async function toDto(tx: Parameters<Parameters<typeof asUser>[1]>[0], rows: Row[]) {
  const users = await getUsers(tx, rows.map((r) => r.host_id));
  return Promise.all(rows.filter((r) => users.has(r.host_id)).map(async (r) => ({
    id: r.id, host: users.get(r.host_id)!, title: r.title, status: r.status,
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    viewers: r.status === "live" ? await viewers(r.id) : 0,
    peakViewers: Math.max(r.peak_viewers, Number(await redis.get(`live:${r.id}:peak`).catch(() => 0)) || 0),
  })));
}

const COLS = sql`id, host_id, title, status, started_at, created_at, ended_at, peak_viewers`;

/** Start: creates the record. The browser then opens the ingest WebSocket at /stream/ingest/:id. */
liveRouter.post("/", idempotent, async (req, res) => {
  const me = requireUser(req);
  const { title } = parse(z.object({ title: z.string().trim().max(100).default("") }), req.body);
  const out = await asUser(me, async (tx) => {
    // One unfinished stream per person (unique partial index). Reuse it rather than fail: e.g. the tab reloaded.
    const existing = await tx.execute<Row>(sql`select ${COLS} from live_streams where host_id = ${me} and status <> 'ended'`);
    if (existing.rows[0]) return (await toDto(tx, existing.rows))[0];
    const id = randomUUID();
    await tx.execute(sql`insert into live_streams (id, host_id, title) values (${id}, ${me}, ${title})`);
    const r = await tx.execute<Row>(sql`select ${COLS} from live_streams where id = ${id}`);
    return (await toDto(tx, r.rows))[0];
  });
  res.status(201).json({ stream: out, ingest: `/stream/ingest/${out!.id}` });
});

/** Who's live now, among you and the people you follow (minus mutes). RLS also applies. */
liveRouter.get("/", async (req, res) => {
  const me = requireUser(req);
  const list = await asUser(me, async (tx) => {
    const r = await tx.execute<Row>(sql`
      select ${COLS} from live_streams l
      where l.status = 'live'
        and (l.host_id = ${me} or l.host_id in (select followee_id from follows where follower_id = ${me}))
        and not exists (select 1 from mutes m where m.muter_id = ${me} and m.muted_id = l.host_id)
      order by l.started_at desc limit 20`);
    return toDto(tx, r.rows);
  });
  res.json({ streams: list });
});

liveRouter.get("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const s = await asUser(me, async (tx) => {
    const r = await tx.execute<Row>(sql`select ${COLS} from live_streams where id = ${id}`);
    return r.rows[0] ? (await toDto(tx, r.rows))[0] : null;
  });
  if (!s) throw notFound("This live video isn't available.");
  res.json({ stream: s, playlist: `/stream/${s.id}/index.m3u8` });
});

/** End (host only, by RLS). The live service also ends it when the broadcaster disconnects. */
liveRouter.post("/:id/end", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const peak = Number(await redis.get(`live:${id}:peak`).catch(() => 0)) || 0;
  const r = await asUser(me, (tx) => tx.execute(sql`
    update live_streams set status = 'ended', ended_at = coalesce(ended_at, now()), peak_viewers = greatest(peak_viewers, ${peak})
    where id = ${id} and host_id = ${me}`));
  if (!r.rowCount) throw notFound();
  await publish([`#live:${id}`], "live:ended", { id });
  res.json({ ok: true, peakViewers: peak });
});
