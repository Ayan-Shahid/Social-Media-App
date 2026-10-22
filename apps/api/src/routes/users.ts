import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client.js";
import { asUser } from "../db/client.js";
import { follows, media, users } from "../db/schema.js";
import { badRequest, notFound, parse, requireUser } from "../lib/http.js";
import { listPosts, parseCursor } from "./posts.js";

export const usersRouter = Router();

export interface PublicUser { id: string; username: string; displayName: string; bio: string; avatarUrl: string | null }

const mediaUrl = (f: string | null | undefined) => (f ? `/media/${f}` : null);

export async function getPublicUser(tx: Tx, id: string): Promise<PublicUser | null> {
  const r = await tx.execute<{ id: string; username: string; display_name: string; bio: string; avatar: string | null }>(sql`
    select u.id, u.username, u.display_name, u.bio, m.file_name as avatar
    from users u left join media m on m.id = u.avatar_media_id where u.id = ${id}`);
  const u = r.rows[0];
  return u ? { id: u.id, username: u.username, displayName: u.display_name, bio: u.bio, avatarUrl: mediaUrl(u.avatar) } : null;
}

export const userColumns = sql`u.id as user_id, u.username, u.display_name, u.bio, um.file_name as user_avatar`;
export const userJoin = sql`left join media um on um.id = u.avatar_media_id`;
export function rowToUser(r: { user_id: string; username: string; display_name: string; bio: string; user_avatar: string | null }): PublicUser {
  return { id: r.user_id, username: r.username, displayName: r.display_name, bio: r.bio, avatarUrl: mediaUrl(r.user_avatar) };
}

usersRouter.get("/search", async (req, res) => {
  const me = requireUser(req);
  const q = parse(z.string().trim().min(1).max(30), req.query.q).replace(/[%_\\]/g, (c) => `\\${c}`);
  const r = await asUser(me, (tx) => tx.execute<Parameters<typeof rowToUser>[0]>(sql`
    select ${userColumns} from users u ${userJoin}
    where u.username ilike ${q + "%"} or u.display_name ilike ${"%" + q + "%"}
    order by (u.username ilike ${q + "%"}) desc, u.username limit 20`));
  res.json({ users: r.rows.map(rowToUser) });
});

/** People you don't follow yet, newest first. */
usersRouter.get("/suggested", async (req, res) => {
  const me = requireUser(req);
  const r = await asUser(me, (tx) => tx.execute<Parameters<typeof rowToUser>[0]>(sql`
    select ${userColumns} from users u ${userJoin}
    where u.id <> ${me} and not exists (select 1 from follows f where f.follower_id = ${me} and f.followee_id = u.id)
    order by u.created_at desc limit 8`));
  res.json({ users: r.rows.map(rowToUser) });
});

usersRouter.get("/:username", async (req, res) => {
  const me = requireUser(req);
  const username = parse(z.string().max(30), req.params.username);
  const out = await asUser(me, async (tx) => {
    const r = await tx.execute<Parameters<typeof rowToUser>[0] & { posts: number; followers: number; following: number; is_following: boolean; follows_me: boolean }>(sql`
      select ${userColumns},
        (select count(*)::int from posts p where p.author_id = u.id) as posts,
        (select count(*)::int from follows f where f.followee_id = u.id) as followers,
        (select count(*)::int from follows f where f.follower_id = u.id) as following,
        exists (select 1 from follows f where f.follower_id = ${me} and f.followee_id = u.id) as is_following,
        exists (select 1 from follows f where f.follower_id = u.id and f.followee_id = ${me}) as follows_me
      from users u ${userJoin} where u.username = ${username}`);
    return r.rows[0];
  });
  if (!out) throw notFound("User not found.");
  res.json({
    user: rowToUser(out),
    counts: { posts: out.posts, followers: out.followers, following: out.following },
    isFollowing: out.is_following, followsMe: out.follows_me, isMe: out.user_id === me,
  });
});

usersRouter.get("/:username/posts", async (req, res) => {
  const me = requireUser(req);
  const username = parse(z.string().max(30), req.params.username);
  const page = await asUser(me, (tx) => listPosts(tx, me, sql`u.username = ${username}`, parseCursor(req.query.cursor), 18));
  res.json(page);
});

const updateSchema = z.object({
  displayName: z.string().trim().max(60).optional(),
  bio: z.string().trim().max(300).optional(),
  avatarMediaId: z.uuid().nullable().optional(),
});

usersRouter.patch("/me", async (req, res) => {
  const me = requireUser(req);
  const body = parse(updateSchema, req.body);
  const user = await asUser(me, async (tx) => {
    if (body.avatarMediaId) {
      const [m] = await tx.select().from(media).where(and(eq(media.id, body.avatarMediaId), eq(media.ownerId, me)));
      if (!m || m.kind !== "image") throw badRequest("Pick a photo you uploaded.", { avatarMediaId: "Invalid photo." });
    }
    await tx.update(users).set({
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.bio !== undefined && { bio: body.bio }),
      ...(body.avatarMediaId !== undefined && { avatarMediaId: body.avatarMediaId }),
    }).where(eq(users.id, me));
    return getPublicUser(tx, me);
  });
  res.json({ user });
});

// Follow / unfollow. PUT and DELETE set the state, so repeating them is harmless (naturally idempotent).
usersRouter.put("/:id/follow", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  if (id === me) throw badRequest("You can't follow yourself.");
  await asUser(me, (tx) => tx.insert(follows).values({ followerId: me, followeeId: id }).onConflictDoNothing());
  res.json({ following: true });
});

usersRouter.delete("/:id/follow", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  await asUser(me, (tx) => tx.delete(follows).where(and(eq(follows.followerId, me), eq(follows.followeeId, id))));
  res.json({ following: false });
});
