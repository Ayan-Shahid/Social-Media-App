import { Router } from "express";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client.js";
import { asUser } from "../db/client.js";
import { commentLikes, comments, postLikes, posts } from "../db/schema.js";
import { notFound, parse, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { rowToUser, userColumns, userJoin, type PublicUser } from "./users.js";

export const postsRouter = Router();
export const commentsRouter = Router();

export interface PostDto {
  id: string;
  author: PublicUser;
  caption: string;
  createdAt: string;
  media: { kind: "image" | "video"; url: string; posterUrl: string | null; width: number; height: number };
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
}

type Cursor = { t: string; id: string } | null;

export function parseCursor(raw: unknown): Cursor {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const [t, id] = Buffer.from(raw, "base64url").toString().split("|");
    if (!t || !id || Number.isNaN(Date.parse(t)) || !/^[0-9a-f-]{36}$/.test(id)) return null;
    return { t, id };
  } catch { return null; }
}
const makeCursor = (t: Date | string, id: string) => Buffer.from(`${new Date(t).toISOString()}|${id}`).toString("base64url");

type PostRow = Parameters<typeof rowToUser>[0] & {
  id: string; caption: string; created_at: string; kind: "image" | "video"; file_name: string; poster_file_name: string | null;
  width: number; height: number; like_count: number; comment_count: number; liked_by_me: boolean;
};

const toPost = (r: PostRow): PostDto => ({
  id: r.id, author: rowToUser(r), caption: r.caption, createdAt: new Date(r.created_at).toISOString(),
  media: { kind: r.kind, url: `/media/${r.file_name}`, posterUrl: r.poster_file_name ? `/media/${r.poster_file_name}` : null, width: r.width, height: r.height },
  likeCount: r.like_count, commentCount: r.comment_count, likedByMe: r.liked_by_me,
});

/** Lists posts matching `where`, newest first, with counts. Keyset pagination (stable while new posts arrive). */
export async function listPosts(tx: Tx, me: string, where: SQL, cursor: Cursor, limit = 12) {
  const r = await tx.execute<PostRow>(sql`
    select p.id, p.caption, p.created_at, m.kind, m.file_name, m.poster_file_name, m.width, m.height, ${userColumns},
      (select count(*)::int from post_likes l where l.post_id = p.id) as like_count,
      (select count(*)::int from comments c where c.post_id = p.id) as comment_count,
      exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = ${me}) as liked_by_me
    from posts p join users u on u.id = p.author_id join media m on m.id = p.media_id ${userJoin}
    where (${where}) ${cursor ? sql`and (p.created_at, p.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)` : sql``}
    order by p.created_at desc, p.id desc limit ${limit + 1}`);
  const rows = r.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return { posts: rows.map(toPost), nextCursor: r.rows.length > limit && last ? makeCursor(last.created_at, last.id) : null };
}

const createSchema = z.object({ mediaId: z.uuid(), caption: z.string().trim().max(2200).default("") });

postsRouter.post("/", idempotent, async (req, res) => {
  const me = requireUser(req);
  const body = parse(createSchema, req.body);
  const post = await asUser(me, async (tx) => {
    // RLS also checks that the media belongs to you; this gives a friendlier error first.
    const own = await tx.execute(sql`select 1 from media where id = ${body.mediaId} and owner_id = ${me}`);
    if (!own.rowCount) throw notFound("Upload not found.");
    const [p] = await tx.insert(posts).values({ authorId: me, mediaId: body.mediaId, caption: body.caption }).returning();
    return (await listPosts(tx, me, sql`p.id = ${p!.id}`, null, 1)).posts[0];
  });
  res.status(201).json({ post });
});

/** Posts from people you follow, plus your own. */
postsRouter.get("/feed", async (req, res) => {
  const me = requireUser(req);
  const page = await asUser(me, (tx) => listPosts(tx, me,
    sql`p.author_id = ${me} or p.author_id in (select followee_id from follows where follower_id = ${me})`, parseCursor(req.query.cursor)));
  res.json(page);
});

/** Everyone's posts, newest first. */
postsRouter.get("/explore", async (req, res) => {
  const me = requireUser(req);
  const page = await asUser(me, (tx) => listPosts(tx, me, sql`true`, parseCursor(req.query.cursor), 24));
  res.json(page);
});

postsRouter.get("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const page = await asUser(me, (tx) => listPosts(tx, me, sql`p.id = ${id}`, null, 1));
  if (!page.posts[0]) throw notFound("Post not found.");
  res.json({ post: page.posts[0] });
});

postsRouter.delete("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  // RLS only lets the author delete; for anyone else zero rows match.
  const deleted = await asUser(me, (tx) => tx.delete(posts).where(eq(posts.id, id)).returning({ id: posts.id }));
  if (!deleted.length) throw notFound("Post not found.");
  res.json({ ok: true });
});

postsRouter.put("/:id/like", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const count = await asUser(me, async (tx) => {
    await tx.insert(postLikes).values({ postId: id, userId: me }).onConflictDoNothing();
    return likeCount(tx, id);
  });
  res.json({ liked: true, likeCount: count });
});

postsRouter.delete("/:id/like", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const count = await asUser(me, async (tx) => {
    await tx.delete(postLikes).where(and(eq(postLikes.postId, id), eq(postLikes.userId, me)));
    return likeCount(tx, id);
  });
  res.json({ liked: false, likeCount: count });
});

async function likeCount(tx: Tx, postId: string) {
  const r = await tx.execute<{ n: number }>(sql`select count(*)::int as n from post_likes where post_id = ${postId}`);
  return r.rows[0]?.n ?? 0;
}

// ---------- comments ----------

type CommentRow = Parameters<typeof rowToUser>[0] & { id: string; body: string; created_at: string; like_count: number; liked_by_me: boolean; can_delete: boolean };

async function listComments(tx: Tx, me: string, where: SQL) {
  const r = await tx.execute<CommentRow>(sql`
    select c.id, c.body, c.created_at, ${userColumns},
      (select count(*)::int from comment_likes l where l.comment_id = c.id) as like_count,
      exists (select 1 from comment_likes l where l.comment_id = c.id and l.user_id = ${me}) as liked_by_me,
      (c.author_id = ${me} or p.author_id = ${me}) as can_delete
    from comments c join posts p on p.id = c.post_id join users u on u.id = c.author_id ${userJoin}
    where ${where} order by c.created_at asc limit 200`);
  return r.rows.map((x) => ({
    id: x.id, body: x.body, createdAt: new Date(x.created_at).toISOString(), author: rowToUser(x),
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
    const exists = await tx.execute(sql`select 1 from posts where id = ${id}`);
    if (!exists.rowCount) throw notFound("Post not found.");
    const [c] = await tx.insert(comments).values({ postId: id, authorId: me, body }).returning();
    return (await listComments(tx, me, sql`c.id = ${c!.id}`))[0];
  });
  res.status(201).json({ comment });
});

commentsRouter.delete("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const deleted = await asUser(me, (tx) => tx.delete(comments).where(eq(comments.id, id)).returning({ id: comments.id }));
  if (!deleted.length) throw notFound("Comment not found.");
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
