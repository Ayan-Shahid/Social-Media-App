// Notifications from events. Idempotent: (event id, recipient) is unique, so a re-delivered event
// can't notify twice (merged likes/reposts use an outbox marker instead, see merge()). Each new notification is pushed live over the realtime bus.
import type { Job } from "bullmq";
import { workerPool } from "../db/worker-pool.js";
import { publish } from "../infra/bus.js";
import { redis } from "../infra/redis.js";
import type { EventMap } from "../infra/outbox.js";

type N = { recipient: string; actor: string; type: "like" | "comment" | "follow" | "mention" | "repost" | "follow_request" | "follow_accept" | "live"; postId?: string; commentId?: string; liveId?: string };

function build(name: string, d: Record<string, unknown>): N[] {
  const out: N[] = [];
  const mentions = (d.mentions as string[] | undefined) ?? [];
  switch (name) {
    case "like.created": { const e = d as EventMap["like.created"]; out.push({ recipient: e.postAuthorId, actor: e.userId, type: "like", postId: e.postId }); break; }
    case "repost.created": { const e = d as EventMap["repost.created"]; out.push({ recipient: e.postAuthorId, actor: e.userId, type: "repost", postId: e.postId }); break; }
    case "follow.created": {
      const e = d as EventMap["follow.created"];
      // An accepted request tells the requester; a plain follow tells the person followed.
      out.push(e.accepted ? { recipient: e.followerId, actor: e.followeeId, type: "follow_accept" } : { recipient: e.followeeId, actor: e.followerId, type: "follow" });
      break;
    }
    case "follow.requested": { const e = d as EventMap["follow.requested"]; out.push({ recipient: e.targetId, actor: e.requesterId, type: "follow_request" }); break; }
    case "comment.created": {
      const e = d as EventMap["comment.created"];
      out.push({ recipient: e.postAuthorId, actor: e.userId, type: "comment", postId: e.postId, commentId: e.commentId });
      for (const m of mentions) out.push({ recipient: m, actor: e.userId, type: "mention", postId: e.postId, commentId: e.commentId });
      break;
    }
    case "post.created": {
      const e = d as EventMap["post.created"];
      for (const m of mentions) out.push({ recipient: m, actor: e.authorId, type: "mention", postId: e.postId });
      break;
    }
  }
  return out.filter((n) => n.recipient !== n.actor);
}

/** "x started a live video" goes to every follower (in batches; a big account is one job, not one per follower). */
async function liveAudience(e: EventMap["live.started"]): Promise<N[]> {
  const r = await workerPool().query<{ follower_id: string }>(
    `select f.follower_id from follows f where f.followee_id = $1
       and not exists (select 1 from mutes m where m.muter_id = f.follower_id and m.muted_id = $1) limit 5000`, [e.hostId]);
  return r.rows.map((x) => ({ recipient: x.follower_id, actor: e.hostId, type: "live" as const, liveId: e.liveId }));
}

export async function notifyJob(job: Job<{ eventId: string } & Record<string, unknown>>) {
  const list = job.name === "live.started" ? await liveAudience(job.data as unknown as EventMap["live.started"]) : build(job.name, job.data);
  let created = 0;
  for (const n of list) {
    // Nothing crosses a block, in either direction.
    const blocked = await workerPool().query(
      "select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1", [n.recipient, n.actor]);
    if (blocked.rowCount) continue;
    if ((n.type === "like" || n.type === "repost") && n.postId) {
      if (await merge(n, job.data.eventId)) { created++; await pushThrottled(n); }
      continue;
    }
    const r = await workerPool().query(
      `insert into notifications (recipient_id, actor_id, type, post_id, comment_id, live_id, event_id, recent_actors)
       values ($1, $2, $3, $4, $5, $6, $7, array[$2::uuid]) on conflict (event_id, recipient_id) do nothing returning id`,
      [n.recipient, n.actor, n.type, n.postId ?? null, n.commentId ?? null, n.liveId ?? null, job.data.eventId]);
    if (r.rowCount) {
      created++;
      await publish([n.recipient], "notification:new", { type: n.type, ...(n.liveId && { liveId: n.liveId }) });
    }
  }
  return { created };
}

/**
 * Likes and reposts are merged as they're written (DECISIONS.md D21): one row per post per day
 * ("leo and 4,182 others liked your post"), not one row per like. Exactly once, even if the job is
 * retried: the outbox event is marked in the same transaction, and a second run finds it marked.
 */
async function merge(n: N, eventId: string) {
  // "and N others" counts PEOPLE: liking, unliking and liking again mustn't count twice. A HyperLogLog
  // per post per day remembers who's been counted (12 KB at most, ~1% error, gone after 2 days).
  // If Redis can't answer, count it (better slightly high than a missing notification).
  const hll = `notif:hll:${n.recipient}:${n.type}:${n.postId}:${new Date().toISOString().slice(0, 10)}`;
  const isNew = await redis.multi().pfadd(hll, n.actor).expire(hll, 2 * 86400).exec()
    .then((r) => (r?.[0]?.[1] === 0 ? 0 : 1), () => 1);
  const c = await workerPool().connect();
  try {
    await c.query("begin");
    const mark = await c.query("update outbox set notified_at = now() where id = $1 and notified_at is null returning id", [eventId]);
    if (!mark.rowCount) { await c.query("rollback"); return false; } // already merged (a retry), or long gone
    await c.query(
      `insert into notifications (recipient_id, actor_id, type, post_id, event_id, bucket, recent_actors, actor_count)
       values ($1, $2, $3, $4, $5, (now() at time zone 'utc')::date, array[$2::uuid], 1)
       on conflict (recipient_id, type, post_id, bucket) where bucket is not null do update set
         actor_id = excluded.actor_id,
         recent_actors = (array[excluded.actor_id] || array_remove(notifications.recent_actors, excluded.actor_id))[1:3],
         actor_count = notifications.actor_count + $6,
         created_at = now(), read_at = null, event_id = excluded.event_id`,
      [n.recipient, n.actor, n.type, n.postId, eventId, isNew]);
    await c.query("commit");
    return true;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e; // retried by BullMQ; nothing was marked
  } finally {
    c.release();
  }
}

/** At most one live push per post per person every 5 seconds: a viral post must not flood the author's tabs. */
async function pushThrottled(n: N) {
  const first = await redis.set(`notif:push:${n.recipient}:${n.postId}`, "1", "PX", 5000, "NX").catch(() => "OK");
  if (first) await publish([n.recipient], "notification:new", { type: n.type });
}
