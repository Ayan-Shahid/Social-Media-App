import { Router } from "express";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client.js";
import { asUser } from "../db/client.js";
import { commentLikes, comments, hashtags, media, mentions, postHashtags, postLikes, postMedia, posts, reposts, savedPosts } from "../db/schema.js";
import { badRequest, notFound, parse, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { emit } from "../infra/outbox.js";
import { cached, invalidate } from "../infra/cache.js";
import { keys, redis } from "../infra/redis.js";
import { makeCursor, parseCursor, type Cursor } from "../lib/cursor.js";
import { uuidList } from "../lib/sql.js";
import { bumpStat, getStats, getUsers, hydrate, loadPosts, POST_CACHE_TTL, type CachedPost } from "../services/hydrate.js";
import { readFeed } from "../services/feed.js";
import { extractHashtags, extractMentions } from "../services/text.js";
import { countTags, trendingTags } from "../services/tags.js";

export const postsRouter = Router();
export const commentsRouter = Router();
export const tagsRouter = Router();

/** Newest-first post ids matching `where`, as a page. */
export async function listIds(tx: Tx, where: SQL, cursor: Cursor, limit: number) {
  const r = await tx.execute<{ id: string; created_at: string }>(sql`
    select p.id, p.created_at from posts p where (${where})
    ${cursor ? sql`and (p.created_at, p.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : sql``}
    order by p.created_at desc, p.id desc limit ${limit + 1}`);
  const rows = r.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return { ids: rows.map((x) => x.id), nextCursor: r.rows.length > limit && last ? makeCursor(last.created_at, last.id) : null };
}

export async function postPage(tx: Tx, me: string, where: SQL, cursor: Cursor, limit = 12) {
  const { ids, nextCursor } = await listIds(tx, where, cursor, limit);
  return { posts: await hydrate(tx, me, ids.map((postId) => ({ postId }))), nextCursor };
}

// ---------- create ----------

const createSchema = z.object({
  mediaIds: z.array(z.uuid()).min(1, "Add a photo or video").max(10, "Up to 10 per post"),
  caption: z.string().trim().max(2200).default(""),
  kind: z.enum(["post", "short"]).default("post"),
});

/** Saves hashtags and mentions for a post or comment. Returns mentioned user ids. */
async function saveTextLinks(tx: Tx, me: string, text: string, target: { postId: string; commentId?: string }, withTags: boolean) {
  const names = extractMentions(text);
  let mentioned: string[] = [];
  if (names.length) {
    const r = await tx.execute<{ id: string }>(sql`select id from users where lower(username::text) in (${sql.join(names.map((n) => sql`${n}`), sql`, `)}) and id <> ${me}`);
    mentioned = r.rows.map((x) => x.id);
    if (mentioned.length) await tx.insert(mentions).values(mentioned.map((u) => ({ authorId: me, mentionedUserId: u, postId: target.postId, commentId: target.commentId ?? null })));
  }
  if (withTags) {
    const tags = extractHashtags(text);
    if (tags.length) {
      await tx.insert(hashtags).values(tags.map((tag) => ({ tag }))).onConflictDoNothing();
      const ids = await tx.execute<{ id: string }>(sql`select id from hashtags where tag in (${sql.join(tags.map((t) => sql`${t}`), sql`, `)})`);
      await tx.insert(postHashtags).values(ids.rows.map((h) => ({ postId: target.postId, hashtagId: h.id }))).onConflictDoNothing();
      countTags(tags).catch(() => {});
    }
  }
  return mentioned;
}

postsRouter.post("/", idempotent, async (req, res) => {
  const me = requireUser(req);
  const body = parse(createSchema, req.body);
  const post = await asUser(me, async (tx) => {
    const ms = await tx.select().from(media).where(and(eq(media.ownerId, me), sql`${media.id} in ${uuidList(body.mediaIds)}`));
    if (ms.length !== new Set(body.mediaIds).size) throw notFound("Upload not found.");
    if (ms.some((m) => m.status !== "ready")) throw badRequest("Still processing your upload. Try again in a moment.");
    if (ms.some((m) => !["post", "short"].includes(m.purpose))) throw badRequest("That upload can't be used in a post.");
    if (body.kind === "short" && (ms.length !== 1 || ms[0]!.kind !== "video")) throw badRequest("A short is exactly one video.");
    const [p] = await tx.insert(posts).values({ authorId: me, caption: body.caption, kind: body.kind }).returning();
    await tx.insert(postMedia).values(body.mediaIds.map((mediaId, position) => ({ postId: p!.id, mediaId, position })));
    const mentioned = await saveTextLinks(tx, me, body.caption, { postId: p!.id }, true);
    await emit(tx, me, "post.created", { postId: p!.id, authorId: me, kind: body.kind, mentions: mentioned, createdAt: p!.createdAt.toISOString() });
    return (await hydrate(tx, me, [{ postId: p!.id }]))[0];
  });
  await redis.hincrby(keys.userStats(me), "posts", 1).catch(() => {});
  res.status(201).json({ post });
});

// ---------- read ----------

postsRouter.get("/feed", async (req, res) => {
  const me = requireUser(req);
  const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;
  res.json(await asUser(me, (tx) => readFeed(tx, me, cursor)));
});

postsRouter.get("/explore", async (req, res) => {
  const me = requireUser(req);
  const cursor = parseCursor(req.query.cursor);
  const out = await asUser(me, async (tx) => {
    // The first page is the same for everyone: cache the id list for 15 s.
    let page: { ids: string[]; nextCursor: string | null } | null = null;
    if (!cursor) page = await cached("explore", "explore:p1", 15, () => listIds(tx, sql`p.kind = 'post'`, null, 24));
    page ??= await listIds(tx, sql`p.kind = 'post'`, cursor, 24);
    return { posts: await hydrate(tx, me, page.ids.map((postId) => ({ postId }))), nextCursor: page.nextCursor };
  });
  res.json(out);
});

postsRouter.get("/shorts", async (req, res) => {
  const me = requireUser(req);
  res.json(await asUser(me, (tx) => postPage(tx, me, sql`p.kind = 'short'`, parseCursor(req.query.cursor), 6)));
});

postsRouter.get("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const post = await asUser(me, async (tx) => {
    // Single-key read with stampede protection: 500 concurrent cold requests -> one database load.
    const p = await cached<CachedPost>("post", keys.post(id), POST_CACHE_TTL, async () => (await loadPosts(tx, [id])).get(id) ?? null);
    if (!p) return null;
    return (await hydrate(tx, me, [{ postId: id }]))[0] ?? null;
  });
  if (!post) throw notFound("Post not found.");
  res.json({ post });
});

// ---------- delete ----------

postsRouter.delete("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const deleted = await asUser(me, async (tx) => {
    const d = await tx.delete(posts).where(eq(posts.id, id)).returning({ id: posts.id }); // RLS: author only
    if (d.length) await emit(tx, me, "post.deleted", { postId: id, authorId: me });
    return d.length;
  });
  if (!deleted) throw notFound("Post not found.");
  await invalidate(keys.post(id), keys.postStats(id), "explore:p1");
  await redis.hincrby(keys.userStats(me), "posts", -1).catch(() => {});
  res.json({ ok: true });
});

// ---------- likes, reposts, saves (PUT/DELETE set a state, so repeats are harmless) ----------

async function authorOf(tx: Tx, postId: string) {
  const r = await tx.execute<{ author_id: string }>(sql`select author_id from posts where id = ${postId}`);
  if (!r.rows[0]) throw notFound("Post not found.");
  return r.rows[0].author_id;
}

postsRouter.put("/:id/like", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const count = await asUser(me, async (tx) => {
    const author = await authorOf(tx, id);
    const ins = await tx.insert(postLikes).values({ postId: id, userId: me }).onConflictDoNothing().returning();
    if (ins.length) {
      await emit(tx, me, "like.created", { postId: id, userId: me, postAuthorId: author });
      await bumpStat(id, "likes", 1);
    }
    return (await getStats(tx, [id])).get(id)?.likes ?? 0;
  });
  res.json({ liked: true, likeCount: count });
});

postsRouter.delete("/:id/like", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const count = await asUser(me, async (tx) => {
    const del = await tx.delete(postLikes).where(and(eq(postLikes.postId, id), eq(postLikes.userId, me))).returning();
    if (del.length) await bumpStat(id, "likes", -1);
    return (await getStats(tx, [id])).get(id)?.likes ?? 0;
  });
  res.json({ liked: false, likeCount: count });
});

postsRouter.put("/:id/repost", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const count = await asUser(me, async (tx) => {
    const author = await authorOf(tx, id);
    if (author === me) throw badRequest("You can't repost your own post.");
    const ins = await tx.insert(reposts).values({ userId: me, postId: id }).onConflictDoNothing().returning();
    if (ins.length) {
      await emit(tx, me, "repost.created", { postId: id, userId: me, postAuthorId: author, createdAt: ins[0]!.createdAt.toISOString() });
      await bumpStat(id, "reposts", 1);
    }
    return (await getStats(tx, [id])).get(id)?.reposts ?? 0;
  });
  res.json({ reposted: true, repostCount: count });
});

postsRouter.delete("/:id/repost", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const count = await asUser(me, async (tx) => {
    const del = await tx.delete(reposts).where(and(eq(reposts.postId, id), eq(reposts.userId, me))).returning();
    if (del.length) {
      await emit(tx, me, "repost.deleted", { postId: id, userId: me });
      await bumpStat(id, "reposts", -1);
    }
    return (await getStats(tx, [id])).get(id)?.reposts ?? 0;
  });
  res.json({ reposted: false, repostCount: count });
});

postsRouter.put("/:id/save", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const { collectionId } = parse(z.object({ collectionId: z.uuid().nullable().optional() }), req.body ?? {});
  await asUser(me, async (tx) => {
    await authorOf(tx, id);
    await tx.insert(savedPosts).values({ userId: me, postId: id, collectionId: collectionId ?? null })
      .onConflictDoUpdate({ target: [savedPosts.userId, savedPosts.postId], set: { collectionId: collectionId ?? null } });
  });
  res.json({ saved: true });
});

postsRouter.delete("/:id/save", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  await asUser(me, (tx) => tx.delete(savedPosts).where(and(eq(savedPosts.postId, id), eq(savedPosts.userId, me))));
  res.json({ saved: false });
});

// ---------- comments ----------

type CommentRow = { id: string; body: string; created_at: string; author_id: string; like_count: number; liked_by_me: boolean; can_delete: boolean };

async function listComments(tx: Tx, me: string, where: SQL) {
  const r = await tx.execute<CommentRow>(sql`
    select c.id, c.body, c.created_at, c.author_id,
      (select count(*)::int from comment_likes l where l.comment_id = c.id) as like_count,
      exists (select 1 from comment_likes l where l.comment_id = c.id and l.user_id = ${me}) as liked_by_me,
      (c.author_id = ${me} or p.author_id = ${me}) as can_delete
    from comments c join posts p on p.id = c.post_id
    where ${where} order by c.created_at asc limit 200`);
  const users = await getUsers(tx, r.rows.map((x) => x.author_id));
  return r.rows.filter((x) => users.has(x.author_id)).map((x) => ({
    id: x.id, body: x.body, createdAt: new Date(x.created_at).toISOString(), author: users.get(x.author_id)!,
    likeCount: x.like_count, likedByMe: x.liked_by_me, canDelete: x.can_delete,
  }));
}

postsRouter.get("/:id/comments", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  res.json({ comments: await asUser(me, (tx) => listComments(tx, me, sql`c.post_id = ${id}`)) });
});

postsRouter.post("/:id/comments", idempotent, async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const { body } = parse(z.object({ body: z.string().trim().min(1, "Write something").max(1000) }), req.body);
  const comment = await asUser(me, async (tx) => {
    const author = await authorOf(tx, id);
    const [c] = await tx.insert(comments).values({ postId: id, authorId: me, body }).returning();
    const mentioned = await saveTextLinks(tx, me, body, { postId: id, commentId: c!.id }, false);
    await emit(tx, me, "comment.created", { postId: id, commentId: c!.id, userId: me, postAuthorId: author, mentions: mentioned });
    await bumpStat(id, "comments", 1);
    return (await listComments(tx, me, sql`c.id = ${c!.id}`))[0];
  });
  res.status(201).json({ comment });
});

commentsRouter.delete("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const deleted = await asUser(me, (tx) => tx.delete(comments).where(eq(comments.id, id)).returning({ postId: comments.postId }));
  if (!deleted.length) throw notFound("Comment not found.");
  await bumpStat(deleted[0]!.postId, "comments", -1);
  res.json({ ok: true });
});

commentsRouter.put("/:id/like", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  await asUser(me, (tx) => tx.insert(commentLikes).values({ commentId: id, userId: me }).onConflictDoNothing());
  res.json({ liked: true });
});

commentsRouter.delete("/:id/like", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  await asUser(me, (tx) => tx.delete(commentLikes).where(and(eq(commentLikes.commentId, id), eq(commentLikes.userId, me))));
  res.json({ liked: false });
});

// ---------- hashtags ----------

tagsRouter.get("/trending", async (req, res) => {
  requireUser(req);
  res.json({ tags: await trendingTags(10) });
});

tagsRouter.get("/:tag", async (req, res) => {
  const me = requireUser(req);
  const tag = parse(z.string().regex(/^[\p{L}\p{N}_]{1,50}$/u, "Invalid tag"), req.params.tag).toLowerCase();
  const out = await asUser(me, async (tx) => {
    const page = await postPage(tx, me, sql`p.id in (select ph.post_id from post_hashtags ph join hashtags h on h.id = ph.hashtag_id where h.tag = ${tag})`, parseCursor(req.query.cursor), 24);
    const c = await tx.execute<{ n: number }>(sql`select count(*)::int as n from post_hashtags ph join hashtags h on h.id = ph.hashtag_id where h.tag = ${tag}`);
    return { tag, count: c.rows[0]?.n ?? 0, ...page };
  });
  res.json(out);
});
