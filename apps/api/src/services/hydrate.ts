// Turns post ids into full post objects for one viewer.
//
// Three layers, each cached differently (DECISIONS.md D4, D9):
//  1. post:{id}        shared, cache-aside, 10 min  -> content, media, author id
//  2. user:{id}        shared, cache-aside, 5 min   -> author's public profile (normalized: an avatar
//                       change invalidates one key, not every post that embeds the author)
//  3. post:{id}:stats  shared, write-through hash, 1 h -> like/comment/repost counts
//  4. per-viewer flags NOT cached: one batched query per request (likedByMe, savedByMe, repostedByMe)
import { sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { cachedMany } from "../infra/cache.js";
import { keys, redis } from "../infra/redis.js";
import { cacheHits, cacheMisses } from "../infra/metrics.js";
import type { MediaVariants } from "../db/schema.js";
import { uuidList } from "../lib/sql.js";

export interface PublicUser { id: string; username: string; displayName: string; bio: string; avatarUrl: string | null }
export interface MediaDto {
  id: string; kind: "image" | "video"; status: "processing" | "ready" | "failed"; error: string | null;
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
    const r = await tx.execute<{ id: string; username: string; display_name: string; bio: string; avatar: MediaVariants | null; avatar_file: string | null }>(sql`
      select u.id, u.username, u.display_name, u.bio, m.variants as avatar, m.file_name as avatar_file
      from users u left join media m on m.id = u.avatar_media_id and m.status = 'ready'
      where u.id in ${uuidList(missing)}`);
    return new Map(r.rows.map((u) => [u.id, {
      id: u.id, username: u.username, displayName: u.display_name, bio: u.bio,
      avatarUrl: u.avatar?.src ? `/media/${u.avatar.src}` : u.avatar_file ? `/media/${u.avatar_file}` : null,
    }]));
  });
}

export const POST_CACHE_TTL = POST_TTL;
export type { CachedPost };

async function getCachedPosts(tx: Tx, ids: string[]) {
  return cachedMany<CachedPost>("post", ids, keys.post, POST_TTL, (missing) => loadPosts(tx, missing));
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

/** Counts from the stats hash; any missing hash is rebuilt from Postgres (the source of truth). */
export async function getStats(tx: Tx, ids: string[]) {
  const out = new Map<string, { likes: number; comments: number; reposts: number }>();
  if (!ids.length) return out;
  const pipe = redis.pipeline();
  for (const id of ids) pipe.hmget(keys.postStats(id), "likes", "comments", "reposts");
  const res = await pipe.exec();
  const missing: string[] = [];
  ids.forEach((id, i) => {
    const v = res?.[i]?.[1] as (string | null)[] | undefined;
    if (!v || v.some((x) => x === null)) missing.push(id);
    else out.set(id, { likes: +v[0]!, comments: +v[1]!, reposts: +v[2]! });
  });
  cacheHits.inc({ cache: "stats" }, ids.length - missing.length);
  if (missing.length) {
    cacheMisses.inc({ cache: "stats" }, missing.length);
    const idList = uuidList(missing);
    const r = await tx.execute<{ id: string; likes: number; comments: number; reposts: number }>(sql`
      select p.id,
        (select count(*)::int from post_likes l where l.post_id = p.id) as likes,
        (select count(*)::int from comments c where c.post_id = p.id) as comments,
        (select count(*)::int from reposts r where r.post_id = p.id) as reposts
      from posts p where p.id in ${idList}`);
    const w = redis.pipeline();
    for (const s of r.rows) {
      out.set(s.id, { likes: s.likes, comments: s.comments, reposts: s.reposts });
      w.hset(keys.postStats(s.id), { likes: s.likes, comments: s.comments, reposts: s.reposts }).expire(keys.postStats(s.id), STATS_TTL);
    }
    await w.exec();
  }
  return out;
}

/** Write-through counter update: only if the hash exists (a missing hash is rebuilt correctly on next read). */
const BUMP = `if redis.call('exists', KEYS[1]) == 1 then return redis.call('hincrby', KEYS[1], ARGV[1], ARGV[2]) end return nil`;
export const bumpStat = (postId: string, field: "likes" | "comments" | "reposts", by: number) =>
  redis.eval(BUMP, 1, keys.postStats(postId), field, by);

export interface FeedRef { postId: string; repostedBy?: string }

/** Full posts for this viewer, in the given order. Missing (deleted) posts are skipped. */
export async function hydrate(tx: Tx, viewer: string, refs: FeedRef[]): Promise<PostDto[]> {
  const ids = [...new Set(refs.map((r) => r.postId))];
  if (!ids.length) return [];
  const posts = await getCachedPosts(tx, ids);
  const present = ids.filter((id) => posts.has(id));
  const userIds = [...present.map((id) => posts.get(id)!.authorId), ...refs.flatMap((r) => (r.repostedBy ? [r.repostedBy] : []))];
  const [users, stats, flags] = await Promise.all([
    getUsers(tx, userIds),
    getStats(tx, present),
    viewerFlags(tx, viewer, present),
  ]);
  const out: PostDto[] = [];
  for (const ref of refs) {
    const p = posts.get(ref.postId);
    const author = p && users.get(p.authorId);
    if (!p || !author) continue;
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
