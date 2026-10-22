// Fan-out on write (DECISIONS.md D3): push new posts/reposts into followers' timelines.
import type { Job } from "bullmq";
import { workerPool } from "../db/worker-pool.js";
import { redis, keys } from "../infra/redis.js";
import { fanoutWrites } from "../infra/metrics.js";
import { config } from "../config.js";
import { PUSH_SCRIPT, member } from "../services/feed.js";
import type { EventMap } from "../infra/outbox.js";

type AnyEvent = { eventId: string } & Partial<EventMap["post.created"] & EventMap["repost.created"] & EventMap["follow.created"]>;

async function followerCount(userId: string) {
  const r = await workerPool().query<{ n: number }>("select count(*)::int as n from follows where followee_id = $1", [userId]);
  return r.rows[0]!.n;
}

/** Pushes one item into the timelines of `userId`'s followers (and their own), 1000 followers per batch. */
async function pushToFollowers(userId: string, ts: number, item: string) {
  let pushed = 0;
  await redis.eval(PUSH_SCRIPT, 1, keys.feed(userId), ts, item, config.FEED_MAX_ITEMS);
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const r = await workerPool().query<{ follower_id: string }>(
      "select follower_id from follows where followee_id = $1 and follower_id > $2 order by follower_id limit 1000", [userId, after]);
    if (!r.rows.length) break;
    const pipe = redis.pipeline();
    for (const f of r.rows) pipe.eval(PUSH_SCRIPT, 1, keys.feed(f.follower_id), ts, item, config.FEED_MAX_ITEMS);
    const res = await pipe.exec();
    pushed += res?.filter(([, v]) => v === 1).length ?? 0;
    after = r.rows[r.rows.length - 1]!.follower_id;
  }
  fanoutWrites.inc(pushed);
  await redis.hincrby("stats:worker", "fanout_writes", pushed);
  return pushed;
}

export async function fanoutJob(job: Job<AnyEvent>) {
  const d = job.data;
  switch (job.name) {
    case "post.created": {
      const ts = Date.parse(d.createdAt!);
      const item = member({ postId: d.postId! });
      // Big accounts are pulled at read time instead: one post must not cause millions of writes.
      if ((await followerCount(d.authorId!)) >= config.FANOUT_THRESHOLD) {
        await redis.eval(PUSH_SCRIPT, 1, keys.feed(d.authorId!), ts, item, config.FEED_MAX_ITEMS);
        return { mode: "pull", pushed: 0 };
      }
      return { mode: "push", pushed: await pushToFollowers(d.authorId!, ts, item) };
    }
    case "repost.created": {
      if ((await followerCount(d.userId!)) >= config.FANOUT_THRESHOLD) return { mode: "pull", pushed: 0 };
      return { mode: "push", pushed: await pushToFollowers(d.userId!, Date.parse(d.createdAt!), member({ postId: d.postId!, repostedBy: d.userId! })) };
    }
    case "follow.created": {
      // Backfill: the new followee's recent posts appear in the follower's feed right away.
      if ((await followerCount(d.followeeId!)) >= config.FANOUT_THRESHOLD) { await redis.del(`feed:pull:${d.followerId}`); return "pull"; }
      const r = await workerPool().query<{ id: string; ts: string }>(
        "select id, (extract(epoch from created_at) * 1000)::bigint as ts from posts where author_id = $1 order by created_at desc limit 20", [d.followeeId]);
      const pipe = redis.pipeline();
      for (const p of r.rows) pipe.eval(PUSH_SCRIPT, 1, keys.feed(d.followerId!), Number(p.ts), member({ postId: p.id }), config.FEED_MAX_ITEMS);
      await pipe.exec();
      return { backfilled: r.rows.length };
    }
    case "follow.deleted":
      await redis.del(`feed:pull:${d.followerId}`); // their items are filtered out lazily at read time
      return "ok";
    default:
      return "ignored"; // post.deleted / repost.deleted: removed lazily when a timeline is read
  }
}
