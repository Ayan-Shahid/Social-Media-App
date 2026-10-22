// Notifications from events. Idempotent: (event id, recipient) is unique, so a re-delivered event
// can't notify twice. Each new notification is pushed live over the realtime bus.
import type { Job } from "bullmq";
import { workerPool } from "../db/worker-pool.js";
import { publish } from "../infra/bus.js";
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
    const r = await workerPool().query(
      `insert into notifications (recipient_id, actor_id, type, post_id, comment_id, live_id, event_id)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (event_id, recipient_id) do nothing returning id`,
      [n.recipient, n.actor, n.type, n.postId ?? null, n.commentId ?? null, n.liveId ?? null, job.data.eventId]);
    if (r.rowCount) {
      created++;
      await publish([n.recipient], "notification:new", { type: n.type, ...(n.liveId && { liveId: n.liveId }) });
    }
  }
  return { created };
}
