import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client.js";
import { asUser } from "../db/client.js";
import { blocks, followRequests, follows, media, mutes, users } from "../db/schema.js";
import { badRequest, forbidden, notFound, parse, requireUser } from "../lib/http.js";
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
  // Shared cache entry, so it must not depend on who asked: counted over all rows (see app.profile_counts).
  const r = await tx.execute<{ posts: number; followers: number; following: number }>(sql`select * from app.profile_counts(${id})`);
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
    const r = await tx.execute<{ id: string; is_following: boolean; follows_me: boolean; requested: boolean; blocked_by_me: boolean; blocked_with: boolean; muted: boolean; can_see: boolean }>(sql`
      select u.id,
        exists (select 1 from follows f where f.follower_id = ${me} and f.followee_id = u.id) as is_following,
        exists (select 1 from follows f where f.follower_id = u.id and f.followee_id = ${me}) as follows_me,
        exists (select 1 from follow_requests r where r.requester_id = ${me} and r.target_id = u.id) as requested,
        exists (select 1 from blocks b where b.blocker_id = ${me} and b.blocked_id = u.id) as blocked_by_me,
        app.blocked_with(u.id) as blocked_with,
        exists (select 1 from mutes m where m.muter_id = ${me} and m.muted_id = u.id) as muted,
        app.can_see(u.id) as can_see
      from users u where u.username = ${username}`);
    const row = r.rows[0];
    if (!row) return null;
    // Blocked by them: the account looks like it doesn't exist (as on Instagram).
    if (row.blocked_with && !row.blocked_by_me) return null;
    const [user, counts] = await Promise.all([getPublicUser(tx, row.id), userStats(tx, row.id)]);
    return {
      user, counts, isMe: row.id === me, isFollowing: row.is_following, followsMe: row.follows_me,
      requested: row.requested, isBlocked: row.blocked_by_me, isMuted: row.muted,
      // false for a private account you don't follow (or one you blocked): the grid shows a lock instead
      canSeePosts: row.can_see,
    };
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
    const u = await tx.execute<{ id: string; can_see: boolean }>(sql`select id, app.can_see(id) as can_see from users where username = ${username}`);
    const id = u.rows[0]?.id;
    // Posts are hidden by RLS anyway; this also hides a private account's reposts list.
    if (!id || !u.rows[0]!.can_see) return { posts: [], nextCursor: null };
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
  isPrivate: z.boolean().optional(),
});

usersRouter.patch("/me", async (req, res) => {
  const me = requireUser(req);
  const body = parse(updateSchema, req.body);
  const newFollowers = await asUser(me, async (tx) => {
    if (body.avatarMediaId) {
      const [m] = await tx.select().from(media).where(and(eq(media.id, body.avatarMediaId), eq(media.ownerId, me)));
      if (!m || m.kind !== "image") throw badRequest("Pick a photo you uploaded.", { avatarMediaId: "Invalid photo." });
    }
    await tx.update(users).set({
      ...(body.displayName !== undefined && { displayName: body.displayName }),
      ...(body.bio !== undefined && { bio: body.bio }),
      ...(body.avatarMediaId !== undefined && { avatarMediaId: body.avatarMediaId }),
      ...(body.isPrivate !== undefined && { isPrivate: body.isPrivate }),
    }).where(eq(users.id, me));
    // Going public accepts every pending request, in the same transaction.
    if (body.isPrivate === false) {
      const r = await tx.execute<{ follower_id: string }>(sql`select app.accept_all_follow_requests() as follower_id`);
      for (const f of r.rows) await emit(tx, me, "follow.created", { followerId: f.follower_id, followeeId: me, accepted: true });
      return r.rows.map((x) => x.follower_id);
    }
    return [];
  });
  // One key: posts reference the author by id, not a copy. Counters are rebuilt from Postgres.
  await invalidate(keys.user(me), ...(newFollowers.length ? [keys.userStats(me), ...newFollowers.map(keys.userStats)] : []));
  const user = await asUser(me, (tx) => getPublicUser(tx, me));
  res.json({ user });
});

/** Follow. For a private account this sends a request instead; the response says which happened. */
usersRouter.put("/:id/follow", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  if (id === me) throw badRequest("You can't follow yourself.");
  const out = await asUser(me, async (tx) => {
    const [t] = (await tx.execute<{ is_private: boolean; following: boolean }>(sql`
      select u.is_private, exists (select 1 from follows f where f.follower_id = ${me} and f.followee_id = u.id) as following
      from users u where u.id = ${id}`)).rows;
    if (!t) throw notFound("User not found.");
    if (t.following) return { following: true, requested: false, created: false };
    try {
      if (t.is_private) {
        const ins = await tx.insert(followRequests).values({ requesterId: me, targetId: id }).onConflictDoNothing().returning();
        if (ins.length) await emit(tx, me, "follow.requested", { requesterId: me, targetId: id });
        return { following: false, requested: true, created: false };
      }
      const ins = await tx.insert(follows).values({ followerId: me, followeeId: id }).onConflictDoNothing().returning();
      if (ins.length) await emit(tx, me, "follow.created", { followerId: me, followeeId: id });
      return { following: true, requested: false, created: ins.length > 0 };
    } catch (e) {
      // The policy (app.can_follow / app.can_request) refused: there's a block between you.
      const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
      if (code === "42501") throw forbidden("You can't follow this account.");
      throw e;
    }
  });
  if (out.created) await Promise.all([bumpUser(id, "followers", 1), bumpUser(me, "following", 1)]);
  res.json({ following: out.following, requested: out.requested });
});

/** Unfollow, or cancel a pending request. */
usersRouter.delete("/:id/follow", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const removed = await asUser(me, async (tx) => {
    await tx.delete(followRequests).where(and(eq(followRequests.requesterId, me), eq(followRequests.targetId, id)));
    const del = await tx.delete(follows).where(and(eq(follows.followerId, me), eq(follows.followeeId, id))).returning();
    if (del.length) await emit(tx, me, "follow.deleted", { followerId: me, followeeId: id });
    return del.length > 0;
  });
  if (removed) await Promise.all([bumpUser(id, "followers", -1), bumpUser(me, "following", -1)]);
  res.json({ following: false, requested: false });
});

/** Remove one of your followers (they keep no access to a private account). */
usersRouter.delete("/:id/follower", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const removed = await asUser(me, async (tx) => {
    const del = await tx.delete(follows).where(and(eq(follows.followerId, id), eq(follows.followeeId, me))).returning();
    if (del.length) await emit(tx, me, "follow.deleted", { followerId: id, followeeId: me });
    return del.length > 0;
  });
  if (removed) await Promise.all([bumpUser(me, "followers", -1), bumpUser(id, "following", -1)]);
  res.json({ ok: true });
});

usersRouter.put("/:id/block", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  if (id === me) throw badRequest("You can't block yourself.");
  await asUser(me, async (tx) => {
    const u = await tx.execute(sql`select 1 from users where id = ${id}`);
    if (!u.rowCount) throw notFound("User not found.");
    await tx.execute(sql`select app.block_user(${id})`); // block + cut follows/requests both ways, atomically
  });
  // Follower counts changed in ways a +1/-1 can't track cleanly: rebuild both from Postgres.
  await invalidate(keys.userStats(me), keys.userStats(id), `feed:pull:${me}`, `feed:pull:${id}`);
  res.json({ blocked: true });
});

usersRouter.delete("/:id/block", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  await asUser(me, (tx) => tx.delete(blocks).where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, id))));
  res.json({ blocked: false });
});

usersRouter.put("/:id/mute", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  if (id === me) throw badRequest("You can't mute yourself.");
  await asUser(me, (tx) => tx.insert(mutes).values({ muterId: me, mutedId: id }).onConflictDoNothing());
  await invalidate(keys.mutes(me));
  res.json({ muted: true });
});

usersRouter.delete("/:id/mute", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  await asUser(me, (tx) => tx.delete(mutes).where(and(eq(mutes.muterId, me), eq(mutes.mutedId, id))));
  await invalidate(keys.mutes(me));
  res.json({ muted: false });
});

// ---------- follow requests (to me) and my block list ----------

export const followRequestsRouter = Router();

followRequestsRouter.get("/", async (req, res) => {
  const me = requireUser(req);
  const list = await asUser(me, async (tx) => {
    const r = await tx.execute<{ requester_id: string; created_at: string }>(sql`
      select requester_id, created_at from follow_requests where target_id = ${me} order by created_at desc limit 100`);
    const u = await getUsers(tx, r.rows.map((x) => x.requester_id));
    return r.rows.flatMap((x) => (u.get(x.requester_id) ? [{ user: u.get(x.requester_id)!, createdAt: new Date(x.created_at).toISOString() }] : []));
  });
  res.json({ requests: list });
});

followRequestsRouter.post("/:userId/accept", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.userId);
  const ok = await asUser(me, async (tx) => {
    const r = await tx.execute<{ ok: boolean }>(sql`select app.accept_follow_request(${id}) as ok`);
    if (r.rows[0]?.ok) await emit(tx, me, "follow.created", { followerId: id, followeeId: me, accepted: true });
    return !!r.rows[0]?.ok;
  });
  if (!ok) throw notFound("That request is gone.");
  await Promise.all([bumpUser(me, "followers", 1), bumpUser(id, "following", 1)]);
  res.json({ ok: true });
});

followRequestsRouter.delete("/:userId", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.userId);
  await asUser(me, (tx) => tx.delete(followRequests).where(and(eq(followRequests.requesterId, id), eq(followRequests.targetId, me))));
  res.json({ ok: true });
});

followRequestsRouter.get("/blocked", async (req, res) => {
  const me = requireUser(req);
  const list = await asUser(me, async (tx) => {
    const r = await tx.select({ id: blocks.blockedId }).from(blocks).where(eq(blocks.blockerId, me));
    const u = await getUsers(tx, r.map((x) => x.id));
    return r.flatMap((x) => (u.get(x.id) ? [u.get(x.id)!] : []));
  });
  res.json({ users: list });
});
