// Notifications from events. Idempotent: (event id, recipient) is unique, so a re-delivered event
// can't notify twice. Each new notification is pushed live over the realtime bus.
import type { Job } from "bullmq";
import { workerPool } from "../db/worker-pool.js";
import { publish } from "../infra/bus.js";
import type { EventMap } from "../infra/outbox.js";

type N = { recipient: string; actor: string; type: "like" | "comment" | "follow" | "mention" | "repost"; postId?: string; commentId?: string };

function build(name: string, d: Record<string, unknown>): N[] {
  const out: N[] = [];
  const mentions = (d.mentions as string[] | undefined) ?? [];
  switch (name) {
    case "like.created": { const e = d as EventMap["like.created"]; out.push({ recipient: e.postAuthorId, actor: e.userId, type: "like", postId: e.postId }); break; }
    case "repost.created": { const e = d as EventMap["repost.created"]; out.push({ recipient: e.postAuthorId, actor: e.userId, type: "repost", postId: e.postId }); break; }
    case "follow.created": { const e = d as EventMap["follow.created"]; out.push({ recipient: e.followeeId, actor: e.followerId, type: "follow" }); break; }
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

export async function notifyJob(job: Job<{ eventId: string } & Record<string, unknown>>) {
  const list = build(job.name, job.data);
  let created = 0;
  for (const n of list) {
    const r = await workerPool().query(
      `insert into notifications (recipient_id, actor_id, type, post_id, comment_id, event_id)
       values ($1, $2, $3, $4, $5, $6) on conflict (event_id, recipient_id) do nothing returning id`,
      [n.recipient, n.actor, n.type, n.postId ?? null, n.commentId ?? null, job.data.eventId]);
    if (r.rowCount) {
      created++;
      await publish([n.recipient], "notification:new", { type: n.type });
    }
  }
  return { created };
}
