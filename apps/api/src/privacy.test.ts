// Private accounts, follow requests, blocking and muting (DECISIONS.md D15).
// Visibility is enforced by RLS (app.can_see) and re-checked per viewer even when content is cached.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { Client, key, resetAll, waitFor } from "./test/harness.js";

let app: Express;
let workers: { close(): Promise<void> };
let priv: Client, fan: Client, stranger: Client, mean: Client, pal: Client;

beforeAll(async () => {
  await resetAll();
  app = (await import("./app.js")).createApp();
  workers = (await import("./worker.js")).startWorkers();
  [priv, fan, stranger, mean, pal] = await Promise.all(["priv", "fan", "stranger", "mean", "pal"].map(async (u) => (await new Client(app).init()).register(u)));
});

afterAll(async () => {
  await workers.close();
  await (await import("./infra/queues.js")).closeQueues();
  await (await import("./db/worker-pool.js")).closeWorkerPool();
  (await import("./infra/redis.js")).redis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

const ids = (r: { body: { posts: { id: string }[] } }) => r.body.posts.map((p) => p.id);

describe("private accounts and follow requests", () => {
  let postId: string;

  it("a private account's posts are hidden from non-followers everywhere", async () => {
    expect((await priv.send("patch", "/api/users/me", { isPrivate: true })).body.user.isPrivate).toBe(true);
    postId = (await priv.post("secret sunset #hidden")).id;
    const profile = await stranger.get("/api/users/priv");
    expect(profile.body.canSeePosts).toBe(false);
    expect(profile.body.counts.posts).toBe(1); // counts stay public, like Instagram
    expect(ids(await stranger.get("/api/users/priv/posts"))).toEqual([]);
    expect((await stranger.get(`/api/posts/${postId}`)).status).toBe(404);
    expect((await stranger.get(`/api/posts/${postId}/comments`)).body.comments).toEqual([]);
    expect(ids(await stranger.get("/api/posts/explore"))).not.toContain(postId);
    expect(ids(await stranger.get("/api/tags/hidden"))).not.toContain(postId);
  });

  it("and you can't interact with what you can't see", async () => {
    expect((await stranger.send("put", `/api/posts/${postId}/like`)).status).toBe(404);
    expect((await stranger.send("post", `/api/posts/${postId}/comments`, { body: "hi" }, { "Idempotency-Key": key() })).status).toBe(404);
    expect((await stranger.send("put", `/api/posts/${postId}/save`)).status).toBe(404);
  });

  it("following a private account sends a request; accepting it grants access and notifies the requester", async () => {
    const r = await fan.send("put", `/api/users/${priv.user!.id}/follow`);
    expect(r.body).toEqual({ following: false, requested: true });
    expect((await fan.get("/api/users/priv")).body.requested).toBe(true);
    await waitFor(async () => (await priv.get("/api/notifications")).body.notifications.some((n: { type: string }) => n.type === "follow_request"), 10000, "request notification");
    const reqs = await priv.get("/api/follow-requests");
    expect(reqs.body.requests.map((x: { user: { username: string } }) => x.user.username)).toEqual(["fan"]);

    expect((await priv.send("post", `/api/follow-requests/${fan.user!.id}/accept`)).status).toBe(200);
    expect((await fan.get(`/api/posts/${postId}`)).status).toBe(200);
    expect((await fan.get("/api/users/priv")).body.canSeePosts).toBe(true);
    // backfilled into the new follower's feed by the worker
    await waitFor(async () => ids(await fan.get("/api/posts/feed")).includes(postId), 10000, "feed backfill");
    await waitFor(async () => (await fan.get("/api/notifications")).body.notifications.some((n: { type: string }) => n.type === "follow_accept"), 10000, "accept notification");
    // Accepting twice, or a request that never existed, is a clean 404
    expect((await priv.send("post", `/api/follow-requests/${fan.user!.id}/accept`)).status).toBe(404);
    expect((await priv.send("post", `/api/follow-requests/${stranger.user!.id}/accept`)).status).toBe(404);
  });

  it("the shared post cache never leaks: a follower's cache fill isn't served to a stranger, and a stranger's miss isn't cached", async () => {
    const p2 = (await priv.post("only for followers")).id;
    expect((await stranger.get(`/api/posts/${p2}`)).status).toBe(404); // miss as a stranger first...
    expect((await fan.get(`/api/posts/${p2}`)).status).toBe(200); // ...must not hide it from a follower
    expect((await stranger.get(`/api/posts/${p2}`)).status).toBe(404); // and the follower's fill must not show it to the stranger
    const { redis, keys } = await import("./infra/redis.js");
    expect(await redis.exists(keys.post(p2))).toBe(1); // the content IS cached, shared; visibility isn't
  });

  it("a follower can be removed, and loses access", async () => {
    await priv.send("delete", `/api/users/${fan.user!.id}/follower`);
    expect((await fan.get(`/api/posts/${postId}`)).status).toBe(404);
  });

  it("going public accepts pending requests", async () => {
    await stranger.send("put", `/api/users/${priv.user!.id}/follow`);
    await priv.send("patch", "/api/users/me", { isPrivate: false });
    const p = await stranger.get("/api/users/priv");
    expect(p.body.isFollowing).toBe(true);
    expect(p.body.canSeePosts).toBe(true);
    expect((await priv.get("/api/follow-requests")).body.requests).toEqual([]);
  });
});

describe("blocking", () => {
  let postId: string;

  it("a block cuts follows both ways and hides each side's content from the other", async () => {
    await mean.follow(pal.user!.id);
    await pal.follow(mean.user!.id);
    postId = (await pal.post("pal's post")).id;
    expect((await pal.send("put", `/api/users/${mean.user!.id}/block`)).status).toBe(200);

    expect((await mean.get("/api/users/pal")).status).toBe(404); // looks like the account doesn't exist
    const mine = await pal.get("/api/users/mean");
    expect(mine.body.isBlocked).toBe(true); // the blocker still sees the profile, to unblock
    expect(mine.body.isFollowing).toBe(false);
    expect(mine.body.followsMe).toBe(false);
    expect((await mean.get(`/api/posts/${postId}`)).status).toBe(404);
    const meanPost = (await mean.post("mean's post")).id;
    expect((await pal.get(`/api/posts/${meanPost}`)).status).toBe(404); // works both ways
  });

  it("the blocked user can't follow back or send a request", async () => {
    expect((await mean.send("put", `/api/users/${pal.user!.id}/follow`)).status).toBe(403);
  });

  it("an existing 1:1 chat can't receive new messages across a block", async () => {
    await pal.send("delete", `/api/users/${mean.user!.id}/block`);
    const conv = (await mean.send("post", "/api/conversations", { userId: pal.user!.id })).body.conversation;
    const send = () => mean.send("post", `/api/conversations/${conv.id}/messages`, { ciphertext: "Q".repeat(40), nonce: "N".repeat(32) }, { "Idempotency-Key": key() });
    expect((await send()).status).toBe(201);
    await pal.send("put", `/api/users/${mean.user!.id}/block`);
    expect((await send()).status).toBe(403);
  });

  it("notifications from a blocked account disappear, and none are created across a block", async () => {
    const fromMean = async () => (await pal.get("/api/notifications")).body.notifications.filter((x: { actors: { username: string }[] }) => x.actors.some((a) => a.username === "mean"));
    expect(await fromMean()).toEqual([]); // the follow notification from before the block is hidden
    await pal.send("delete", `/api/users/${mean.user!.id}/block`);
    expect((await fromMean()).length).toBeGreaterThan(0); // ...and comes back on unblock
    await pal.send("put", `/api/users/${mean.user!.id}/block`);
    const p = (await pal.post("after the block")).id;
    expect((await mean.send("put", `/api/posts/${p}/like`)).status).toBe(404);
    const { workerPool } = await import("./db/worker-pool.js");
    const before = (await workerPool().query("select count(*)::int as n from notifications where actor_id = $1", [mean.user!.id])).rows[0].n;
    await new Promise((r) => setTimeout(r, 500)); // give the worker a moment
    expect((await workerPool().query("select count(*)::int as n from notifications where actor_id = $1", [mean.user!.id])).rows[0].n).toBe(before);
  });

  it("the blocker's list shows who they blocked; only they can read it", async () => {
    expect((await pal.get("/api/follow-requests/blocked")).body.users.map((u: { username: string }) => u.username)).toEqual(["mean"]);
    expect((await mean.get("/api/follow-requests/blocked")).body.users).toEqual([]);
  });
});

describe("muting", () => {
  it("hides someone from your feed without unfollowing; unmuting brings them back", async () => {
    const u = (await new Client(app).init()), v = (await new Client(app).init());
    await u.register("muter"); await v.register("chatty");
    await u.follow(v.user!.id);
    const p = (await v.post("so much to say")).id;
    await waitFor(async () => ids(await u.get("/api/posts/feed")).includes(p), 10000, "fan-out");
    await u.send("put", `/api/users/${v.user!.id}/mute`);
    expect(ids(await u.get("/api/posts/feed"))).not.toContain(p);
    expect((await u.get("/api/users/chatty")).body).toMatchObject({ isMuted: true, isFollowing: true });
    expect((await u.get(`/api/posts/${p}`)).status).toBe(200); // still reachable directly
    await u.send("delete", `/api/users/${v.user!.id}/mute`);
    expect(ids(await u.get("/api/posts/feed"))).toContain(p);
  });
});
