// Transactional outbox (DECISIONS.md D5).
//
// Routes call `emit(tx, ...)` inside the same transaction as the change. The relay (running in the
// worker process) moves committed events to BullMQ. Guarantees:
//  - rolled-back changes never produce events (the row never existed)
//  - committed changes always produce events, even if the process crashes right after commit
//  - each event is delivered at least once; consumers are idempotent (jobId = event id)
import pg from "pg";
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { outbox } from "../db/schema.js";
import { queue, type QueueName } from "./queues.js";
import { outboxRelayed } from "./metrics.js";

export type EventMap = {
  "media.uploaded": { mediaId: string; ownerId: string; kind: "image" | "video"; purpose: string };
  "post.created": { postId: string; authorId: string; kind: "post" | "short"; mentions: string[]; createdAt: string };
  "post.deleted": { postId: string; authorId: string };
  "repost.created": { postId: string; userId: string; postAuthorId: string; createdAt: string };
  "repost.deleted": { postId: string; userId: string };
  "like.created": { postId: string; userId: string; postAuthorId: string };
  "comment.created": { postId: string; commentId: string; userId: string; postAuthorId: string; mentions: string[] };
  "follow.created": { followerId: string; followeeId: string; accepted?: boolean }; // accepted: came from a request
  "follow.requested": { requesterId: string; targetId: string };
  "follow.deleted": { followerId: string; followeeId: string };
};
export type EventType = keyof EventMap;

/** Which queues each event goes to. One event can drive several independent jobs. */
const ROUTES: Record<EventType, QueueName[]> = {
  "media.uploaded": ["media"],
  "post.created": ["fanout", "notify"],
  "post.deleted": ["fanout"],
  "repost.created": ["fanout", "notify"],
  "repost.deleted": ["fanout"],
  "like.created": ["notify"],
  "comment.created": ["notify"],
  "follow.created": ["fanout", "notify"],
  "follow.requested": ["notify"],
  "follow.deleted": ["fanout"],
};

/** Records an event in the current transaction. Wakes the relay via NOTIFY (delivered on commit). */
export async function emit<T extends EventType>(tx: Tx, actorId: string, type: T, payload: EventMap[T]) {
  await tx.insert(outbox).values({ type, actorId, payload });
  await tx.execute(sql`select pg_notify('outbox_new', '')`);
}

export interface RelayHandle { stop(): Promise<void>; drain(): Promise<number> }

/** Moves committed events to the queues. Safe to run several relays at once (SKIP LOCKED). */
export function startRelay(databaseUrl: string, opts: { intervalMs?: number; batch?: number } = {}): RelayHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const listener = new pg.Client({ connectionString: databaseUrl });
  const intervalMs = opts.intervalMs ?? 1000;
  const batch = opts.batch ?? 100;
  let stopped = false;
  let running: Promise<number> | null = null;

  async function drainOnce(): Promise<number> {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const r = await c.query<{ id: string; type: EventType; payload: unknown; created_at: Date }>(
        "select id, type, payload, created_at from outbox where published_at is null order by id limit $1 for update skip locked", [batch]);
      for (const e of r.rows) {
        for (const q of ROUTES[e.type] ?? []) {
          // jobId = event id: if this relay crashes after adding but before marking published,
          // the retry adds the same jobId again and BullMQ ignores the duplicate.
          await queue(q).add(e.type, { eventId: e.id, ...(e.payload as object) }, { jobId: `${q}-e${e.id}` });
        }
      }
      if (r.rows.length) {
        await c.query("update outbox set published_at = now(), attempts = attempts + 1 where id = any($1::bigint[])", [r.rows.map((e) => e.id)]);
      }
      await c.query("commit");
      outboxRelayed.inc(r.rows.length);
      return r.rows.length;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function drain(): Promise<number> {
    if (running) return running;
    running = (async () => {
      let total = 0;
      for (;;) {
        const n = await drainOnce();
        total += n;
        if (n < batch) return total;
      }
    })().finally(() => { running = null; });
    return running;
  }

  const tick = () => { if (!stopped) drain().catch((e) => console.error("[relay] drain failed", e.message)); };
  const timer = setInterval(tick, intervalMs);
  listener.connect().then(() => listener.query("listen outbox_new")).then(() => {
    listener.on("notification", tick);
  }).catch((e) => console.error("[relay] listen failed, polling only", e.message));
  tick();

  return {
    drain,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running?.catch(() => {});
      await listener.end().catch(() => {});
      await pool.end().catch(() => {});
    },
  };
}
