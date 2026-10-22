// "Swap the id in the URL" (IDOR). Mallory knows the ids of everything Alice and Bob own, and tries
// every route that takes an id. Ids are random UUIDs, but that's not the defence: every query runs as
// the signed-in user (app.user_id comes from the session cookie, never from the URL) under RLS.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { Client, key, pngBuffer, resetAll, waitFor } from "./test/harness.js";

let app: Express;
let workers: { close(): Promise<void> };
let alice: Client, bob: Client, mallory: Client;
const ids: Record<string, string> = {};

beforeAll(async () => {
  await resetAll();
  app = (await import("./app.js")).createApp();
  workers = (await import("./worker.js")).startWorkers();
  [alice, bob, mallory] = await Promise.all(["alice", "bob", "mallory"].map(async (u) => (await new Client(app).init()).register(u)));

  ids.unusedMedia = (await alice.upload(await pngBuffer("#123456"))).id;
  const slot = await alice.send("post", "/api/media/uploads", { purpose: "post", mime: "image/png", size: 100 }, { "Idempotency-Key": key() });
  ids.pendingUpload = slot.body.media.id;
  ids.post = (await alice.post("alice's post")).id;
  ids.comment = (await alice.send("post", `/api/posts/${ids.post}/comments`, { body: "alice's comment" }, { "Idempotency-Key": key() })).body.comment.id;
  ids.collection = (await alice.send("post", "/api/collections", { name: "Alice's private stuff" })).body.collection.id;
  await alice.send("put", `/api/posts/${ids.post}/save`, { collectionId: ids.collection });
  ids.dm = (await alice.send("post", "/api/conversations", { userId: bob.user!.id })).body.conversation.id;
  await alice.send("post", `/api/conversations/${ids.dm}/messages`, { ciphertext: "Q".repeat(40), nonce: "N".repeat(32) }, { "Idempotency-Key": key() });
  const storyMedia = await alice.upload(await pngBuffer("#654321"), "s.png", "story");
  ids.story = (await alice.send("post", "/api/stories", { mediaId: storyMedia.id }, { "Idempotency-Key": key() })).body.story.id;
  ids.live = (await alice.send("post", "/api/live", { title: "alice live" }, { "Idempotency-Key": key() })).body.stream.id;
  await alice.send("patch", "/api/users/me", { isPrivate: true });
  await bob.send("put", `/api/users/${alice.user!.id}/follow`); // pending request to alice
});

afterAll(async () => {
  await workers.close();
  await (await import("./infra/queues.js")).closeQueues();
  await (await import("./db/worker-pool.js")).closeWorkerPool();
  (await import("./infra/redis.js")).redis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

describe("mallory swaps in other people's ids", () => {
  it("media: can't read, or complete someone else's upload", async () => {
    expect((await mallory.get(`/api/media/${ids.unusedMedia}`)).status).toBe(404);
    expect((await mallory.send("post", `/api/media/${ids.pendingUpload}/complete`)).status).toBe(404);
  });

  it("media: can't put someone else's photo in her own post, story or avatar", async () => {
    expect((await mallory.send("post", "/api/posts", { mediaIds: [ids.unusedMedia], caption: "stolen" }, { "Idempotency-Key": key() })).status).toBeGreaterThanOrEqual(400);
    expect((await mallory.send("post", "/api/stories", { mediaId: ids.unusedMedia }, { "Idempotency-Key": key() })).status).toBeGreaterThanOrEqual(400);
    expect((await mallory.send("patch", "/api/users/me", { avatarMediaId: ids.unusedMedia })).status).toBe(400);
  });

  it("posts and comments: can't delete them (private account: can't even see them)", async () => {
    expect((await mallory.send("delete", `/api/posts/${ids.post}`)).status).toBe(404);
    expect((await mallory.send("delete", `/api/comments/${ids.comment}`)).status).toBe(404);
    expect((await mallory.get(`/api/posts/${ids.post}`)).status).toBe(404);
    expect((await mallory.get(`/api/posts/${ids.post}/comments`)).body.comments).toEqual([]);
  });

  it("collections: can't delete, list or add to someone else's", async () => {
    expect((await mallory.send("delete", `/api/collections/${ids.collection}`)).status).toBe(404);
    expect((await mallory.get(`/api/collections/saved?collection=${ids.collection}`)).body.posts).toEqual([]);
  });

  it("chats: can't read, list keys, post into, rotate, or leave someone else's conversation", async () => {
    expect((await mallory.get(`/api/conversations/${ids.dm}`)).status).toBe(404);
    const msgs = await mallory.get(`/api/conversations/${ids.dm}/messages`);
    expect(msgs.body.messages ?? []).toEqual([]);
    expect((await mallory.get(`/api/conversations/${ids.dm}/keys`)).body.keys).toEqual([]);
    expect((await mallory.send("post", `/api/conversations/${ids.dm}/messages`, { ciphertext: "Q".repeat(40), nonce: "N".repeat(32) }, { "Idempotency-Key": key() })).status).toBe(404);
    expect((await mallory.send("post", `/api/conversations/${ids.dm}/rotate`, { expectedEpoch: 0, wraps: [{ userId: mallory.user!.id, wrappedKey: "A".repeat(60), nonce: "N".repeat(32) }] })).status).toBe(404);
    expect((await mallory.send("post", `/api/conversations/${ids.dm}/leave`)).status).toBe(404);
    expect((await alice.get(`/api/conversations/${ids.dm}/messages`)).body.messages).toHaveLength(1); // untouched
  });

  it("stories: can't see who viewed someone else's story, or delete it", async () => {
    expect((await mallory.get(`/api/stories/${ids.story}/viewers`)).status).toBe(404);
    expect((await alice.get(`/api/stories/${ids.story}/viewers`)).status).toBe(200);
    expect((await mallory.send("delete", `/api/stories/${ids.story}`)).status).toBe(404);
  });

  it("live: can't see, or end someone else's live video", async () => {
    expect((await mallory.get(`/api/live/${ids.live}`)).status).toBe(404); // private account
    expect((await mallory.send("post", `/api/live/${ids.live}/end`)).status).toBe(404);
    expect((await alice.get(`/api/live/${ids.live}`)).body.stream.status).toBe("starting");
  });

  it("follow requests: can't accept or decline a request on someone else's behalf", async () => {
    expect((await mallory.send("post", `/api/follow-requests/${bob.user!.id}/accept`)).status).toBe(404);
    await mallory.send("delete", `/api/follow-requests/${bob.user!.id}`);
    expect((await alice.get("/api/follow-requests")).body.requests.map((r: { user: { username: string } }) => r.user.username)).toEqual(["bob"]);
  });

  it("notifications and blocks are only ever your own", async () => {
    await alice.send("put", `/api/users/${mallory.user!.id}/block`);
    expect((await mallory.get("/api/follow-requests/blocked")).body.users).toEqual([]);
    expect((await mallory.get("/api/notifications")).body.notifications).toEqual([]);
    await waitFor(async () => (await alice.get("/api/notifications")).body.notifications.length > 0, 10000, "alice's own notifications");
  });

  it("the shared Redis cache holds nothing private: no emails, sessions, messages, key material or collections", async () => {
    const { redis } = await import("./infra/redis.js");
    const dump: string[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "COUNT", 500);
      cursor = next;
      for (const k of keys) {
        const t = await redis.type(k);
        const v = t === "string" ? await redis.get(k) : t === "hash" ? JSON.stringify(await redis.hgetall(k)) : t === "set" ? (await redis.smembers(k)).join(",") : t === "zset" ? (await redis.zrange(k, 0, -1)).join(",") : "";
        dump.push(`${k}=${v}`);
      }
    } while (cursor !== "0");
    const all = dump.join("\n");
    expect(dump.length).toBeGreaterThan(5); // the cache is in use
    for (const secret of ["alice@example.com", "password", "argon2", "QQQQQQQQ", "ciphertext", "wrapped", "Alice's private stuff", "publicKey"]) {
      expect(all, `found "${secret}" in Redis`).not.toContain(secret);
    }
  });

  it("anonymous visitors get only aggregate numbers (landing page), nothing about anyone", async () => {
    const request = (await import("supertest")).default;
    const r = await request(app).get("/api/public/stats");
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["at", "liveNow", "people", "posts", "shorts", "storiesToday"]);
    expect(r.body.people).toBe(3);
    for (const v of [r.body.people, r.body.posts, r.body.shorts, r.body.storiesToday, r.body.liveNow]) expect(typeof v).toBe("number");
    expect((await request(app).get("/api/posts/explore")).status).toBe(401); // everything else still needs a login
  });
});
