// Home feed with hybrid fan-out (DECISIONS.md D3).
//
// Each user's timeline is a Redis sorted set `feed:{userId}`: score = time (ms), member = "p|postId"
// for a post or "r|postId|reposterId" for a repost. Workers PUSH new posts into followers' timelines,
// except for authors with >= FANOUT_THRESHOLD followers, whose posts are PULLED here at read time.
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { redis, keys } from "../infra/redis.js";
import { config } from "../config.js";
import { uuidList } from "../lib/sql.js";
import { hydrate, type FeedRef, type PostDto } from "./hydrate.js";

const TIMELINE_TTL = 14 * 86400; // inactive users cost nothing; rebuilt when they come back

export const member = (r: FeedRef) => (r.repostedBy ? `r|${r.postId}|${r.repostedBy}` : `p|${r.postId}`);
export function parseMember(m: string): FeedRef {
  const [t, postId, by] = m.split("|");
  return t === "r" ? { postId: postId!, repostedBy: by } : { postId: postId! };
}

/** Adds an item to a timeline only if the timeline exists, then trims it to the cap. Atomic (Lua). */
export const PUSH_SCRIPT = `
if redis.call('exists', KEYS[1]) == 1 then
  redis.call('zadd', KEYS[1], ARGV[1], ARGV[2])
  redis.call('zremrangebyrank', KEYS[1], 0, -(tonumber(ARGV[3]) + 1))
  return 1
end
return 0`;

type Row = { post_id: string; reposted_by: string | null; ts: string };

/** The source query, used to rebuild a timeline and to read past its end. Pushed authors only. */
function sourceQuery(viewer: string, beforeMs: number | null, limit: number) {
  const before = beforeMs ? sql`and t.ts < ${beforeMs}` : sql``;
  return sql`
    select * from (
      select p.id as post_id, null::uuid as reposted_by, (extract(epoch from p.created_at) * 1000)::bigint as ts
      from posts p
      where p.author_id = ${viewer} or p.author_id in (select followee_id from follows where follower_id = ${viewer})
      union all
      select r.post_id, r.user_id, (extract(epoch from r.created_at) * 1000)::bigint
      from reposts r where r.user_id in (select followee_id from follows where follower_id = ${viewer})
    ) t where true ${before}
    order by t.ts desc limit ${limit}`;
}

async function ensureTimeline(tx: Tx, viewer: string) {
  const key = keys.feed(viewer);
  if (await redis.exists(key)) { await redis.expire(key, TIMELINE_TTL); return; }
  const r = await tx.execute<Row>(sourceQuery(viewer, null, config.FEED_MAX_ITEMS));
  const pipe = redis.multi().del(key);
  // A placeholder member keeps empty timelines "existing", so fan-out still pushes into them.
  pipe.zadd(key, 0, "x|empty");
  for (const x of r.rows) pipe.zadd(key, Number(x.ts), member({ postId: x.post_id, repostedBy: x.reposted_by ?? undefined }));
  pipe.expire(key, TIMELINE_TTL);
  await pipe.exec();
}

/** Followed accounts that are big enough to be pulled instead of pushed. Cached per viewer for 5 min. */
async function pulledAuthors(tx: Tx, viewer: string): Promise<string[]> {
  const ck = `feed:pull:${viewer}`;
  const hit = await redis.get(ck);
  if (hit) return JSON.parse(hit);
  const r = await tx.execute<{ id: string }>(sql`
    select f.followee_id as id from follows f
    where f.follower_id = ${viewer}
      and (select count(*) from follows x where x.followee_id = f.followee_id) >= ${config.FANOUT_THRESHOLD}`);
  const ids = r.rows.map((x) => x.id);
  await redis.set(ck, JSON.stringify(ids), "EX", 300);
  return ids;
}

export interface FeedPage { posts: PostDto[]; nextCursor: string | null; source: { timeline: number; pulled: number; fallback: number } }

export async function readFeed(tx: Tx, viewer: string, cursor: string | null, limit = 12): Promise<FeedPage> {
  await ensureTimeline(tx, viewer);
  const before = cursor && /^\d+$/.test(cursor) ? Number(cursor) : null;
  const key = keys.feed(viewer);

  // 1. Pushed items from Redis.
  const raw = await redis.zrevrangebyscore(key, before ? `(${before}` : "+inf", "1", "WITHSCORES", "LIMIT", 0, limit * 2);
  const items: { ref: FeedRef; ts: number; m: string }[] = [];
  for (let i = 0; i < raw.length; i += 2) items.push({ ref: parseMember(raw[i]!), ts: Number(raw[i + 1]), m: raw[i]! });
  const source = { timeline: items.length, pulled: 0, fallback: 0 };

  // 2. Pulled items from big accounts.
  const pulled = await pulledAuthors(tx, viewer);
  if (pulled.length) {
    const r = await tx.execute<Row>(sql`
      select id as post_id, null as reposted_by, (extract(epoch from created_at) * 1000)::bigint as ts from posts
      where author_id in ${uuidList(pulled)} ${before ? sql`and created_at < to_timestamp(${before / 1000})` : sql``}
      order by created_at desc limit ${limit}`);
    for (const x of r.rows) items.push({ ref: { postId: x.post_id }, ts: Number(x.ts), m: `p|${x.post_id}` });
    source.pulled = r.rows.length;
  }

  // 3. Past the end of a full (capped) timeline: read older items straight from Postgres.
  if (items.length < limit && (await redis.zcard(key)) > config.FEED_MAX_ITEMS) {
    const oldest = items.length ? Math.min(...items.map((x) => x.ts)) : before;
    const r = await tx.execute<Row>(sourceQuery(viewer, oldest, limit));
    for (const x of r.rows) items.push({ ref: { postId: x.post_id, repostedBy: x.reposted_by ?? undefined }, ts: Number(x.ts), m: "" });
    source.fallback = r.rows.length;
  }

  // Merge newest first; a post shows once (its newest appearance: original or repost).
  items.sort((a, b) => b.ts - a.ts);
  const seen = new Set<string>();
  const page = items.filter((x) => (seen.has(x.ref.postId) ? false : (seen.add(x.ref.postId), true))).slice(0, limit);

  const posts = await hydrate(tx, viewer, page.map((x) => x.ref));
  // Lazy cleanup: drop deleted posts and items from people you no longer follow.
  const following = await followingSet(tx, viewer, page.flatMap((x) => [x.ref.repostedBy ?? "", ...posts.filter((p) => p.id === x.ref.postId).map((p) => p.author.id)]));
  const shown = new Set(posts.map((p) => p.id));
  const stale = page.filter((x) => x.m && (!shown.has(x.ref.postId) || !stillVisible(x.ref, posts, viewer, following))).map((x) => x.m);
  if (stale.length) redis.zrem(key, ...stale).catch(() => {});
  // Mutes hide, but don't delete: unmuting brings the items back, so they stay in the timeline.
  const muted = await mutedSet(tx, viewer);
  const visible = posts.filter((p) => stillVisible({ postId: p.id, repostedBy: p.repostedBy?.id }, posts, viewer, following)
    && !muted.has(p.author.id) && !(p.repostedBy && muted.has(p.repostedBy.id)));

  const last = page[page.length - 1];
  return { posts: visible, nextCursor: page.length === limit && last ? String(last.ts) : null, source };
}

function stillVisible(ref: FeedRef, posts: PostDto[], viewer: string, following: Set<string>) {
  const via = ref.repostedBy ?? posts.find((p) => p.id === ref.postId)?.author.id;
  return !via || via === viewer || following.has(via);
}

async function followingSet(tx: Tx, viewer: string, ids: string[]) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Set<string>();
  const r = await tx.execute<{ id: string }>(sql`select followee_id as id from follows where follower_id = ${viewer} and followee_id in ${uuidList(list)}`);
  return new Set(r.rows.map((x) => x.id));
}

/** Who the viewer muted. Read on every feed page, so kept as a Redis set (with a marker for "none"). */
export async function mutedSet(tx: Tx, viewer: string): Promise<Set<string>> {
  const k = keys.mutes(viewer);
  const cachedIds = await redis.smembers(k);
  if (cachedIds.length) return new Set(cachedIds.filter((x) => x !== "-"));
  const r = await tx.execute<{ id: string }>(sql`select muted_id as id from mutes where muter_id = ${viewer}`);
  await redis.multi().sadd(k, "-", ...r.rows.map((x) => x.id)).expire(k, 3600).exec();
  return new Set(r.rows.map((x) => x.id));
}
