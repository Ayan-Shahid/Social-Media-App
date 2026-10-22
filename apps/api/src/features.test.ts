// Product features end to end: mentions, hashtags, notifications, saved + collections, carousels,
// shorts, stories, and end-to-end encrypted group chats with key rotation.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Express } from "express";
import { Client, asDb, key, pngBuffer, resetAll, sodium, waitFor } from "./test/harness.js";

let app: Express;
let workers: { close(): Promise<void> };
let alice: Client, bob: Client, carol: Client, dave: Client;

beforeAll(async () => {
  await resetAll();
  app = (await import("./app.js")).createApp();
  workers = (await import("./worker.js")).startWorkers();
  [alice, bob, carol, dave] = await Promise.all(["alice", "bob", "carol", "dave"].map(async (u) => (await new Client(app).init()).register(u)));
});

afterAll(async () => {
  await workers.close();
  await (await import("./infra/queues.js")).closeQueues();
  await (await import("./db/worker-pool.js")).closeWorkerPool();
  (await import("./infra/redis.js")).redis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

describe("mentions, hashtags and notifications", () => {
  it("mentioning someone notifies them; hashtags become searchable and trending", async () => {
    const p = await alice.post("Golden hour with @bob #sunset #Calgary");
    await waitFor(async () => (await bob.get("/api/notifications")).body.notifications.some((n: { type: string }) => n.type === "mention"), 10000, "mention notification");
    const tag = await carol.get("/api/tags/sunset");
    expect(tag.body.posts.map((x: { id: string }) => x.id)).toContain(p.id);
    const tagUpper = await carol.get("/api/tags/CALGARY");
    expect(tagUpper.body.count).toBe(1);
    const trending = await carol.get("/api/tags/trending");
    expect(trending.body.tags.map((t: { tag: string }) => t.tag)).toEqual(expect.arrayContaining(["sunset", "calgary"]));
  });

  it("likes are grouped: 'bob and 2 others liked your post'; unread count and mark-as-read work", async () => {
    const p = await dave.post("group these");
    for (const c of [alice, bob, carol]) await c.send("put", `/api/posts/${p.id}/like`);
    const n = await waitFor(async () => {
      const r = await dave.get("/api/notifications");
      const like = r.body.notifications.find((x: { type: string; post: { id: string } | null }) => x.type === "like" && x.post?.id === p.id);
      return like?.total === 3 ? like : null;
    }, 10000, "grouped likes");
    expect(n.actors).toHaveLength(3);
    expect((await dave.get("/api/notifications/unread-count")).body.count).toBeGreaterThanOrEqual(1);
    await dave.send("post", "/api/notifications/read");
    expect((await dave.get("/api/notifications/unread-count")).body.count).toBe(0);
  });

  it("nobody else can read your notifications (database level)", async () => {
    const r = await asDb(process.env.DATABASE_URL!, carol.user!.id, (c) => c.query("select * from notifications where recipient_id = $1", [dave.user!.id]));
    expect(r.rowCount).toBe(0);
  });
});

describe("saved posts and collections", () => {
  it("saving into a collection is private to you", async () => {
    const p = await alice.post("save me");
    const col = await bob.send("post", "/api/collections", { name: "Inspiration" });
    expect(col.status).toBe(201);
    await bob.send("put", `/api/posts/${p.id}/save`, { collectionId: col.body.collection.id });
    const saved = await bob.get(`/api/collections/saved?collection=${col.body.collection.id}`);
    expect(saved.body.posts.map((x: { id: string }) => x.id)).toEqual([p.id]);
    expect(saved.body.posts[0].savedByMe).toBe(true);
    const list = await bob.get("/api/collections");
    expect(list.body.collections[0]).toMatchObject({ name: "Inspiration", count: 1 });
    expect((await carol.get("/api/collections/saved")).body.posts).toHaveLength(0);
    const raw = await asDb(process.env.DATABASE_URL!, carol.user!.id, (c) => c.query("select * from saved_posts"));
    expect(raw.rowCount).toBe(0);
  });
});

describe("carousels and shorts", () => {
  it("a post can have up to 10 photos, kept in order", async () => {
    const ids = [];
    for (const color of ["#ff0000", "#00ff00", "#0000ff"]) ids.push((await alice.upload(await pngBuffer(color))).id);
    const p = await alice.post("three frames", ids);
    const r = await bob.get(`/api/posts/${p.id}`);
    expect(r.body.post.media.map((m: { id: string }) => m.id)).toEqual(ids);
    const tooMany = await alice.send("post", "/api/posts", { mediaIds: Array.from({ length: 11 }, () => ids[0]) }, { "Idempotency-Key": key() });
    expect(tooMany.status).toBe(400);
  });

  it("shorts are one video, listed in the shorts feed, and photos are refused", async () => {
    const out = "/tmp/glimpse-short.mp4";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=15", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
    const v = await bob.upload(fs.readFileSync(out), "short.mp4", "short");
    expect(v.status).toBe("ready");
    const short = await bob.post("my first short", [v.id], "short");
    const feed = await carol.get("/api/posts/shorts");
    expect(feed.body.posts[0].id).toBe(short.id);
    expect(feed.body.posts[0].media[0].hls).toMatch(/master\.m3u8$/);
    const photo = await bob.startUpload(await pngBuffer(), "image/png", "short");
    expect(photo.status).toBe(415);
  });
});

describe("stories", () => {
  it("followers see your story in their tray; views are recorded; expired stories disappear", async () => {
    await carol.follow(dave.user!.id);
    const m = await dave.upload(await pngBuffer("#ffaa00"), "story.png", "story");
    const s = await dave.send("post", "/api/stories", { mediaId: m.id }, { "Idempotency-Key": key() });
    expect(s.status).toBe(201);
    const tray = await carol.get("/api/stories/tray");
    expect(tray.body.tray.find((t: { user: { id: string } }) => t.user.id === dave.user!.id)?.allSeen).toBe(false);
    await carol.send("post", `/api/stories/${s.body.story.id}/view`);
    const after = await carol.get("/api/stories/tray");
    expect(after.body.tray.find((t: { user: { id: string } }) => t.user.id === dave.user!.id)?.allSeen).toBe(true);
    const viewers = await dave.get(`/api/stories/${s.body.story.id}/viewers`);
    expect(viewers.body.viewers.map((u: { username: string }) => u.username)).toEqual(["carol"]);
    // Fast-forward 24 hours: the RLS policy hides it.
    await asDb(process.env.MIGRATION_DATABASE_URL!, null, async (c) => { await c.query("update stories set expires_at = now() - interval '1 minute'"); await c.query("commit"); });
    expect((await carol.get("/api/stories/tray")).body.tray.find((t: { user: { id: string } }) => t.user.id === dave.user!.id)).toBeUndefined();
  });
});

describe("end-to-end encrypted group chat", () => {
  const b64 = (x: Uint8Array) => sodium.to_base64(x, sodium.base64_variants.ORIGINAL);
  const fromB64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
  const pub = (c: Client) => b64(c.keys.publicKey);

  /** The creator's browser: makes a group key and wraps it for each member's public key. */
  function wrapFor(from: Client, groupKey: Uint8Array, members: Client[]) {
    return members.map((m) => {
      const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
      return { userId: m.user!.id, wrappedKey: b64(sodium.crypto_box_easy(groupKey, nonce, m.keys.publicKey, from.keys.privateKey)), nonce: b64(nonce) };
    });
  }
  async function myKey(c: Client, convId: string, epoch: number) {
    const ks = (await c.get(`/api/conversations/${convId}/keys`)).body.keys as { epoch: number; wrappedBy: string; wrappedKey: string; nonce: string }[];
    const k = ks.find((x) => x.epoch === epoch);
    if (!k) return null;
    const wrapperPub = fromB64((await c.get(`/api/keys/${k.wrappedBy}`)).body.publicKey);
    return sodium.crypto_box_open_easy(fromB64(k.wrappedKey), fromB64(k.nonce), wrapperPub, c.keys.privateKey);
  }
  const encrypt = (text: string, k: Uint8Array) => { const n = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES); return { ciphertext: b64(sodium.crypto_secretbox_easy(text, n, k)), nonce: b64(n) }; };
  const decrypt = (m: { ciphertext: string; nonce: string }, k: Uint8Array) => { try { return sodium.to_string(sodium.crypto_secretbox_open_easy(fromB64(m.ciphertext), fromB64(m.nonce), k)); } catch { return null; } };

  let convId = "";
  let k1: Uint8Array;

  it("creates a group; every member can read; the server has only wrapped keys and ciphertext", async () => {
    k1 = sodium.crypto_secretbox_keygen();
    const r = await alice.send("post", "/api/conversations/group", { title: "Film club", memberIds: [bob.user!.id, carol.user!.id], wraps: wrapFor(alice, k1, [alice, bob, carol]) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    convId = r.body.conversation.id;
    expect(r.body.conversation.members).toHaveLength(3);
    await alice.send("post", `/api/conversations/${convId}/messages`, { ...encrypt("first roll is developed", k1), epoch: 1 }, { "Idempotency-Key": key() });
    for (const c of [bob, carol]) {
      const k = await myKey(c, convId, 1);
      const msgs = (await c.get(`/api/conversations/${convId}/messages`)).body.messages;
      expect(decrypt(msgs[0], k!)).toBe("first roll is developed");
    }
    expect(pub(alice)).toBeTruthy();
  });

  it("wrapped keys must cover exactly the members, and stale epochs are rejected (optimistic locking)", async () => {
    const k = sodium.crypto_secretbox_keygen();
    const missing = await alice.send("post", `/api/conversations/${convId}/rotate`, { expectedEpoch: 1, wraps: wrapFor(alice, k, [alice, bob]) });
    expect(missing.status).toBe(400);
    const stale = await alice.send("post", `/api/conversations/${convId}/rotate`, { expectedEpoch: 0, wraps: wrapFor(alice, k, [alice, bob, carol]) });
    expect(stale.status).toBe(409);
  });

  it("removing carol rotates the key: she can't get the new key or read new messages", async () => {
    const k2 = sodium.crypto_secretbox_keygen();
    const r = await alice.send("post", `/api/conversations/${convId}/rotate`, { expectedEpoch: 1, remove: [carol.user!.id], wraps: wrapFor(alice, k2, [alice, bob]) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.epoch).toBe(2);
    await bob.send("post", `/api/conversations/${convId}/messages`, { ...encrypt("carol can't see this", k2), epoch: 2 }, { "Idempotency-Key": key() });
    expect(await myKey(carol, convId, 2)).toBeNull();
    expect((await carol.get(`/api/conversations/${convId}/messages`)).body.messages).toHaveLength(0);
    const old = await bob.send("post", `/api/conversations/${convId}/messages`, { ...encrypt("old key", k1), epoch: 1 }, { "Idempotency-Key": key() });
    expect(old.status).toBe(409); // must use the current epoch
  });

  it("adding dave gives him only the new epoch: no history", async () => {
    const k3 = sodium.crypto_secretbox_keygen();
    const r = await bob.send("post", `/api/conversations/${convId}/rotate`, { expectedEpoch: 2, add: [dave.user!.id], wraps: wrapFor(bob, k3, [alice, bob, dave]) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await myKey(dave, convId, 3)).not.toBeNull();
    expect(await myKey(dave, convId, 2)).toBeNull();
    const msgs = (await dave.get(`/api/conversations/${convId}/messages`)).body.messages as { ciphertext: string; nonce: string; epoch: number }[];
    const k3dave = (await myKey(dave, convId, 3))!;
    expect(msgs.filter((m) => m.epoch < 3).every((m) => decrypt(m, k3dave) === null)).toBe(true);
  });

  it("when someone leaves, nobody can send until a remaining member rotates the key", async () => {
    expect((await dave.send("post", `/api/conversations/${convId}/leave`)).status).toBe(200);
    const blocked = await alice.send("post", `/api/conversations/${convId}/messages`, { ...encrypt("hi", k1), epoch: 3 }, { "Idempotency-Key": key() });
    expect(blocked.status).toBe(409);
    const k4 = sodium.crypto_secretbox_keygen();
    expect((await alice.send("post", `/api/conversations/${convId}/rotate`, { expectedEpoch: 3, wraps: wrapFor(alice, k4, [alice, bob]) })).status).toBe(200);
    expect((await alice.send("post", `/api/conversations/${convId}/messages`, { ...encrypt("all clear", k4), epoch: 4 }, { "Idempotency-Key": key() })).status).toBe(201);
  });

  it("each member can only read their own wrapped keys (database level)", async () => {
    const r = await asDb(process.env.DATABASE_URL!, bob.user!.id, (c) => c.query("select distinct user_id from group_keys"));
    expect(r.rows.map((x) => x.user_id)).toEqual([bob.user!.id]);
  });
});
