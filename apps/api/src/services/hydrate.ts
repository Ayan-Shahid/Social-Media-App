// Turns post ids into full post objects for one viewer.
//
// Three layers, each cached differently (DECISIONS.md D4, D9):
//  1. post:{id}        shared, cache-aside, 10 min  -> content, media, author id
//  2. user:{id}        shared, cache-aside, 5 min   -> author's public profile (normalized: an avatar
//                       change invalidates one key, not every post that embeds the author)
//  3. post:{id}:stats  shared, write-through hash, 1 h -> like/comment/repost counts
//  4. per-viewer flags NOT cached: one batched query per request (likedByMe, savedByMe, repostedByMe)
import { sql } from "drizzle-orm";
import { asUser, type Tx } from "../db/client.js";
import { cachedMany } from "../infra/cache.js";
import { keys, redis } from "../infra/redis.js";
import { cacheHits, cacheMisses, dbLoads } from "../infra/metrics.js";
import type { MediaVariants } from "../db/schema.js";
import { uuidList } from "../lib/sql.js";

export interface PublicUser { id: string; username: string; displayName: string; bio: string; avatarUrl: string | null; isPrivate: boolean }
export interface MediaDto {
  id: string; kind: "image" | "video"; status: "uploading" | "processing" | "ready" | "failed"; error: string | null;
  url: string | null; srcset: { w: number; url: string }[]; hls: string | null; posterUrl: string | null;
  width: number; height: number; durationMs: number | null;
}
interface CachedPost { id: string; authorId: string; kind: "post" | "short"; caption: string; createdAt: string; media: MediaDto[] }
export interface PostDto extends Omit<CachedPost, "authorId"> {
  author: PublicUser; likeCount: number; commentCount: number; repostCount: number;
  likedByMe: boolean; savedByMe: boolean; repostedByMe: boolean; repostedBy: PublicUser | null;
}

const POST_TTL = 600;
const USER_TTL = 300;
const STATS_TTL = 3600;

export function mediaDto(m: {
  id: string; kind: string; status: string; error: string | null; variants: MediaVariants | null; file_name: string | null;
  poster_file_name: string | null; width: number; height: number; duration_ms: number | null;
}): MediaDto {
  const v = m.variants ?? {};
  const url = v.src ? `/media/${v.src}` : m.file_name ? `/media/${m.file_name}` : null;
  const poster = v.poster ? `/media/${v.poster}` : m.poster_file_name ? `/media/${m.poster_file_name}` : null;
  return {
    id: m.id, kind: m.kind as MediaDto["kind"], status: m.status as MediaDto["status"], error: m.error,
    url, srcset: (v.srcset ?? []).map((s) => ({ w: s.w, url: `/media/${s.path}` })), hls: v.hls ? `/media/${v.hls}` : null,
    posterUrl: poster, width: m.width, height: m.height, durationMs: m.duration_ms,
  };
}

const MEDIA_COLS = sql`m.id, m.kind, m.status, m.error, m.variants, m.file_name, m.poster_file_name, m.width, m.height, m.duration_ms`;

export async function getUsers(tx: Tx, ids: string[]): Promise<Map<string, PublicUser>> {
  return cachedMany<PublicUser>("user", [...new Set(ids)], keys.user, USER_TTL, async (missing) => {
    const r = await tx.execute<{ id: string; username: string; display_name: string; bio: string; is_private: boolean; avatar: MediaVariants | null; avatar_file: string | null }>(sql`
      select u.id, u.username, u.display_name, u.bio, u.is_private, m.variants as avatar, m.file_name as avatar_file
      from users u left join media m on m.id = u.avatar_media_id and m.status = 'ready'
      where u.id in ${uuidList(missing)}`);
    return new Map(r.rows.map((u) => [u.id, {
      id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, isPrivate: u.is_private,
      avatarUrl: u.avatar?.src ? `/media/${u.avatar.src}` : u.avatar_file ? `/media/${u.avatar_file}` : null,
    }]));
  });
}

export const POST_CACHE_TTL = POST_TTL;
export type { CachedPost };

async function getCachedPosts(tx: Tx, ids: string[]) {
  return cachedMany<CachedPost>("post", ids, keys.post, POST_TTL, (missing) => loadPosts(tx, missing), { negative: false });
}

/** Loads posts straight from Postgres in the shape stored in post:{id}. */
export async function loadPosts(tx: Tx, missing: string[]): Promise<Map<string, CachedPost>> {
  {
    const idList = uuidList(missing);
    const posts = await tx.execute<{ id: string; author_id: string; kind: "post" | "short"; caption: string; created_at: string }>(
      sql`select id, author_id, kind, caption, created_at from posts where id in ${idList}`);
    const media = await tx.execute<Parameters<typeof mediaDto>[0] & { post_id: string }>(
      sql`select pm.post_id, ${MEDIA_COLS} from post_media pm join media m on m.id = pm.media_id where pm.post_id in ${idList} order by pm.position`);
    const byPost = new Map<string, MediaDto[]>();
    for (const m of media.rows) { const l = byPost.get(m.post_id) ?? []; l.push(mediaDto(m)); byPost.set(m.post_id, l); }
    return new Map(posts.rows.map((p) => [p.id, {
      id: p.id, authorId: p.author_id, kind: p.kind, caption: p.caption, createdAt: new Date(p.created_at).toISOString(), media: byPost.get(p.id) ?? [],
    }]));
  }
}

type Stats = { likes: number; comments: number; reposts: number };
type Recount = (ids: string[]) => Promise<Map<string, Stats>>;

const STATS_FIELDS = ["likes", "comments", "reposts"] as const;
const statsInflight = new Map<string, Promise<Stats | undefined>>(); // same-process single-flight
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readStats(ids: string[]) {
  const pipe = redis.pipeline();
  for (const id of ids) pipe.hmget(keys.postStats(id), ...STATS_FIELDS);
  const res = await pipe.exec();
  const out = new Map<string, Stats>();
  ids.forEach((id, i) => {
    const v = res?.[i]?.[1] as (string | null)[] | undefined;
    if (v && v.every((x) => x !== null)) out.set(id, { likes: +v[0]!, comments: +v[1]!, reposts: +v[2]! });
  });
  return out;
}

/** The recount, straight from Postgres (the source of truth). Writes the hash back for everyone. */
function recountWith(tx: Tx): Recount {
  return async (ids) => {
    dbLoads.inc({ cache: "stats" });
    const r = await tx.execute<{ id: string } & Stats>(sql`
      select p.id,
        (select count(*)::int from post_likes l where l.post_id = p.id) as likes,
        (select count(*)::int from comments c where c.post_id = p.id) as comments,
        (select count(*)::int from reposts r where r.post_id = p.id) as reposts
      from posts p where p.id in ${uuidList(ids)}`);
    const out = new Map<string, Stats>();
    const w = redis.pipeline();
    for (const s of r.rows) {
      out.set(s.id, { likes: s.likes, comments: s.comments, reposts: s.reposts });
      w.hset(keys.postStats(s.id), { likes: s.likes, comments: s.comments, reposts: s.reposts }).expire(keys.postStats(s.id), STATS_TTL);
    }
    await w.exec();
    return out;
  };
}

/**
 * Missing counts, loaded ONCE however many requests ask at the same moment (a hot post whose hash
 * just expired). In this process, later callers share the first caller's promise. Across instances,
 * a short Redis lock per post: the holder recounts, the others wait up to ~1.5 s for its result.
 */
async function loadMissing(ids: string[], recount: Recount) {
  const out = new Map<string, Stats>();
  const mine: string[] = [];
  const waits: Promise<void>[] = [];
  const retry: string[] = [];
  for (const id of ids) {
    const p = statsInflight.get(id);
    // (A shared result can be missing: the other caller may not be allowed to see this post. Then recount.)
    if (p) waits.push(p.then((v) => { if (v) out.set(id, v); else retry.push(id); }));
    else mine.push(id);
  }
  if (mine.length) {
    let resolveAll!: (m: Map<string, Stats>) => void;
    const batch = new Promise<Map<string, Stats>>((r) => { resolveAll = r; });
    for (const id of mine) statsInflight.set(id, batch.then((m) => m.get(id)));
    try {
      const locks = await Promise.all(mine.map((id) => redis.set(keys.lock(keys.postStats(id)), "1", "PX", 3000, "NX")));
      const locked = mine.filter((_id, i) => locks[i]);
      let others = mine.filter((_id, i) => !locks[i]);
      const got = locked.length ? await recount(locked) : new Map<string, Stats>();
      // Another instance is recounting these: wait for its result instead of repeating the query.
      for (let i = 0; i < 15 && others.length; i++) {
        await sleep(100);
        const v = await readStats(others);
        for (const [id, st] of v) got.set(id, st);
        others = others.filter((id) => !v.has(id));
      }
      if (others.length) for (const [id, st] of await recount(others)) got.set(id, st); // it gave up or crashed
      if (locked.length) await redis.del(...locked.map((id) => keys.lock(keys.postStats(id))));
      for (const [id, st] of got) out.set(id, st);
      resolveAll(got);
    } catch (e) {
      resolveAll(new Map());
      throw e;
    } finally {
      for (const id of mine) statsInflight.delete(id);
    }
  }
  await Promise.all(waits);
  if (retry.length) for (const [id, st] of await recount(retry)) out.set(id, st);
  return out;
}

async function statsVia(ids: string[], recount: Recount) {
  if (!ids.length) return new Map<string, Stats>();
  const out = await readStats(ids);
  const missing = ids.filter((id) => !out.has(id));
  cacheHits.inc({ cache: "stats" }, ids.length - missing.length);
  if (missing.length) {
    cacheMisses.inc({ cache: "stats" }, missing.length);
    for (const [id, st] of await loadMissing(missing, recount)) out.set(id, st);
  }
  return out;
}

/** Counts from the stats hash; any missing hash is rebuilt from Postgres, once (see loadMissing). */
export const getStats = (tx: Tx, ids: string[]) => statsVia(ids, recountWith(tx));

/** Same, outside a transaction: opens one (as `viewer`) only if something has to be recounted. */
export const getStatsAs = (viewer: string, ids: string[]) =>
  statsVia(ids, (missing) => asUser(viewer, (tx) => recountWith(tx)(missing)));

/**
 * Write-through counter update: only if the hash exists (a missing hash is rebuilt correctly on next read).
 * Call it AFTER the transaction that changed the rows has committed, never inside it: a rolled-back
 * like must not move the number.
 */
const BUMP = `if redis.call('exists', KEYS[1]) == 1 then return redis.call('hincrby', KEYS[1], ARGV[1], ARGV[2]) end return nil`;
export const bumpStat = (postId: string, field: "likes" | "comments" | "reposts", by: number) =>
  redis.eval(BUMP, 1, keys.postStats(postId), field, by).catch(() => null); // Redis down: the count heals on expiry

export interface FeedRef { postId: string; repostedBy?: string }

/** Full posts for this viewer, in the given order. Missing (deleted) posts are skipped. */
export async function hydrate(tx: Tx, viewer: string, refs: FeedRef[]): Promise<PostDto[]> {
  const ids = [...new Set(refs.map((r) => r.postId))];
  if (!ids.length) return [];
  // Visibility is decided per viewer, in Postgres, on every read (DECISIONS.md D15). The post content
  // may come from the shared cache, but the cache never decides who may see it: viewerFlags reads
  // `posts` under the viewer's RLS, so a post they can't see (private account, block) has no row.
  const [posts, flags] = await Promise.all([getCachedPosts(tx, ids), viewerFlags(tx, viewer, ids)]);
  const present = ids.filter((id) => posts.has(id) && flags.has(id));
  const userIds = [...present.map((id) => posts.get(id)!.authorId), ...refs.flatMap((r) => (r.repostedBy ? [r.repostedBy] : []))];
  const [users, stats] = await Promise.all([getUsers(tx, userIds), getStats(tx, present)]);
  const out: PostDto[] = [];
  for (const ref of refs) {
    const p = posts.get(ref.postId);
    const author = p && users.get(p.authorId);
    if (!p || !author || !flags.has(p.id)) continue;
    const s = stats.get(p.id) ?? { likes: 0, comments: 0, reposts: 0 };
    const f = flags.get(p.id);
    const { authorId: _a, ...rest } = p;
    out.push({
      ...rest, author, likeCount: s.likes, commentCount: s.comments, repostCount: s.reposts,
      likedByMe: !!f?.liked, savedByMe: !!f?.saved, repostedByMe: !!f?.reposted,
      repostedBy: ref.repostedBy ? users.get(ref.repostedBy) ?? null : null,
    });
  }
  return out;
}

/** Per-viewer facts for a page of posts, in one query. Never cached in shared entries. */
async function viewerFlags(tx: Tx, viewer: string, ids: string[]) {
  const out = new Map<string, { liked: boolean; saved: boolean; reposted: boolean }>();
  if (!ids.length) return out;
  const idList = uuidList(ids);
  const r = await tx.execute<{ id: string; liked: boolean; saved: boolean; reposted: boolean }>(sql`
    select p.id,
      exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = ${viewer}) as liked,
      exists (select 1 from saved_posts s where s.post_id = p.id and s.user_id = ${viewer}) as saved,
      exists (select 1 from reposts r where r.post_id = p.id and r.user_id = ${viewer}) as reposted
    from posts p where p.id in ${idList}`);
  for (const x of r.rows) out.set(x.id, x);
  return out;
}
