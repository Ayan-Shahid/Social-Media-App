import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client.js";
import { asUser } from "../db/client.js";
import { follows, media, users } from "../db/schema.js";
import { badRequest, notFound, parse, requireUser } from "../lib/http.js";
import { emit } from "../infra/outbox.js";
import { invalidate } from "../infra/cache.js";
import { keys, redis } from "../infra/redis.js";
import { parseCursor } from "../lib/cursor.js";
import { getUsers, hydrate, type PublicUser } from "../services/hydrate.js";
import { postPage } from "./posts.js";

export const usersRouter = Router();
export type { PublicUser };

/** Kept for code that needs one user. Reads through the user cache. */
export async function getPublicUser(tx: Tx, id: string): Promise<PublicUser | null> {
  return (await getUsers(tx, [id])).get(id) ?? null;
}

/** Profile counters, cached in a hash and kept in step on follow/post (rebuilt from Postgres when missing). */
async function userStats(tx: Tx, id: string) {
  const k = keys.userStats(id);
  const v = await redis.hmget(k, "posts", "followers", "following");
  if (v.every((x) => x !== null)) return { posts: +v[0]!, followers: +v[1]!, following: +v[2]! };
  const r = await tx.execute<{ posts: number; followers: number; following: number }>(sql`
    select (select count(*)::int from posts where author_id = ${id}) as posts,
           (select count(*)::int from follows where followee_id = ${id}) as followers,
           (select count(*)::int from follows where follower_id = ${id}) as following`);
  const s = r.rows[0]!;
  await redis.multi().hset(k, s).expire(k, 3600).exec();
  return s;
}
const bumpUser = (id: string, field: "followers" | "following", by: number) =>
  redis.eval(`if redis.call('exists', KEYS[1]) == 1 then return redis.call('hincrby', KEYS[1], ARGV[1], ARGV[2]) end return nil`, 1, keys.userStats(id), field, by);

type Row = { id: string };

usersRouter.get("/search", async (req, res) => {
  const me = requireUser(req);
  const q = parse(z.string().trim().min(1).max(30), req.query.q).replace(/[%_\\]/g, (c) => `\\${c}`);
  const list = await asUser(me, async (tx) => {
    const r = await tx.execute<Row>(sql`
      select id from users where username ilike ${q + "%"} or display_name ilike ${"%" + q + "%"}
      order by (username ilike ${q + "%"}) desc, username limit 20`);
    const u = await getUsers(tx, r.rows.map((x) => x.id));
    return r.rows.map((x) => u.get(x.id)).filter(Boolean);
  });
  res.json({ users: list });
});

usersRouter.get("/suggested", async (req, res) => {
  const me = requireUser(req);
  const list = await asUser(me, async (tx) => {
    // Friends of friends first, then newest users.
    const r = await tx.execute<Row>(sql`
      select u.id from users u
      where u.id <> ${me} and not exists (select 1 from follows f where f.follower_id = ${me} and f.followee_id = u.id)
      order by (select count(*) from follows f2 where f2.followee_id = u.id
                and f2.follower_id in (select followee_id from follows where follower_id = ${me})) desc, u.created_at desc
      limit 8`);
    const u = await getUsers(tx, r.rows.map((x) => x.id));
    return r.rows.map((x) => u.get(x.id)).filter(Boolean);
  });
  res.json({ users: list });
});

usersRouter.get("/:username", async (req, res) => {
  const me = requireUser(req);
  const username = parse(z.string().max(30), req.params.username);
  const out = await asUser(me, async (tx) => {
    const r = await tx.execute<{ id: string; is_following: boolean; follows_me: boolean }>(sql`
      select u.id,
        exists (select 1 from follows f where f.follower_id = ${me} and f.followee_id = u.id) as is_following,
        exists (select 1 from follows f where f.follower_id = u.id and f.followee_id = ${me}) as follows_me
      from users u where u.username = ${username}`);
    const row = r.rows[0];
    if (!row) return null;
    const [user, counts] = await Promise.all([getPublicUser(tx, row.id), userStats(tx, row.id)]);
    return { user, counts, isFollowing: row.is_following, followsMe: row.follows_me, isMe: row.id === me };
  });
  if (!out) throw notFound("User not found.");
  res.json(out);
});

/** ?tab=posts (default) | shorts | reposts */
usersRouter.get("/:username/posts", async (req, res) => {
  const me = requireUser(req);
  const username = parse(z.string().max(30), req.params.username);
  const tab = parse(z.enum(["posts", "shorts", "reposts"]).default("posts"), req.query.tab);
  const cursor = parseCursor(req.query.cursor);
  const out = await asUser(me, async (tx) => {
    const u = await tx.execute<Row>(sql`select id from users where username = ${username}`);
    const id = u.rows[0]?.id;
    if (!id) return { posts: [], nextCursor: null };
    if (tab === "reposts") {
      const r = await tx.execute<{ post_id: string }>(sql`select post_id from reposts where user_id = ${id} order by created_at desc limit 60`);
      return { posts: await hydrate(tx, me, r.rows.map((x) => ({ postId: x.post_id, repostedBy: id }))), nextCursor: null };
    }
    return postPage(tx, me, sql`p.author_id = ${id} and p.kind = ${tab === "shorts" ? "short" : "post"}`, cursor, 18);
  });
  res.json(out);
});

const updateSchema = z.object({
  displayName: z.string().trim().max(60).optional(),
  bio: z.string().trim().max(300).optional(),
  avatarMediaId: z.uuid().nullable().optional(),
});

usersRouter.patch("/me", async (req, res) => {
  const me = requireUser(req);
  const body = parse(updateSchema, req.body);
  await asUser(me, async (tx) => {
    if (body.avatarMediaId) {
      const [m] = await tx.select().from(media).where(and(eq(media.id, body.avatarMediaId), eq(media.ownerId, me)));
      if (!m || m.kind !== "image") throw badRequest("Pick a photo you uploaded.", { avatarMediaId: "Invalid photo." });
    }
    await tx.update(users).set({
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.bio !== undefined && { bio: body.bio }),
      ...(body.avatarMediaId !== undefined && { avatarMediaId: body.avatarMediaId }),
    }).where(eq(users.id, me));
  });
  await invalidate(keys.user(me)); // one key: posts reference the author by id, not a copy
  const user = await asUser(me, (tx) => getPublicUser(tx, me));
  res.json({ user });
});

usersRouter.put("/:id/follow", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  if (id === me) throw badRequest("You can't follow yourself.");
  const created = await asUser(me, async (tx) => {
    const ins = await tx.insert(follows).values({ followerId: me, followeeId: id }).onConflictDoNothing().returning();
    if (ins.length) await emit(tx, me, "follow.created", { followerId: me, followeeId: id });
    return ins.length > 0;
  });
  if (created) await Promise.all([bumpUser(id, "followers", 1), bumpUser(me, "following", 1)]);
  res.json({ following: true });
});

usersRouter.delete("/:id/follow", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const removed = await asUser(me, async (tx) => {
    const del = await tx.delete(follows).where(and(eq(follows.followerId, me), eq(follows.followeeId, id))).returning();
    if (del.length) await emit(tx, me, "follow.deleted", { followerId: me, followeeId: id });
    return del.length > 0;
  });
  if (removed) await Promise.all([bumpUser(id, "followers", -1), bumpUser(me, "following", -1)]);
  res.json({ following: false });
});
