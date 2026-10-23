// Many people at once: like counts under concurrency, one recount for a hot post, merged like
// notifications, rate limits (and what happens when Redis is down), and upload cleanup.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Express } from "express";
import { Client, key, pngBuffer, resetAll, waitFor } from "./test/harness.js";

let app: Express;
let workers: { close(): Promise<void> };
let alice: Client, bob: Client, carol: Client;
let fans: Client[] = [];

/** Owner connection that commits (the harness helper rolls back). */
async function owner<T>(fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

beforeAll(async () => {
  await resetAll();
  app = (await import("./app.js")).createApp();
  workers = (await import("./worker.js")).startWorkers();
  [alice, bob, carol] = await Promise.all(["alice", "bob", "carol"].map(async (u) => (await new Client(app).init()).register(u)));
  fans = await Promise.all(Array.from({ length: 25 }, async (_x, i) => (await new Client(app).init()).register(`fan${i}`)));
});

afterAll(async () => {
  await workers.close();
  await (await import("./infra/queues.js")).closeQueues();
  await (await import("./db/worker-pool.js")).closeWorkerPool();
  (await import("./infra/redis.js")).redis.disconnect();
  (await import("./infra/redis.js")).limitsRedis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

describe("likes under load", () => {
  it("25 people liking at the same moment: every like counted once, in Postgres and in the Redis counter", async () => {
    const p = await alice.post("popular");
    await alice.get(`/api/posts/${p.id}`); // warm the counter hash
    const rs = await Promise.all(fans.flatMap((f) => [f.send("put", `/api/posts/${p.id}/like`), f.send("put", `/api/posts/${p.id}/like`)])); // double taps too
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const { redis } = await import("./infra/redis.js");
    expect(await redis.hget(`post:${p.id}:stats`, "likes")).toBe("25");
    const db = await owner((c) => c.query<{ n: number }>("select count(*)::int as n from post_likes where post_id = $1", [p.id]));
    expect(db.rows[0]!.n).toBe(25);
    expect((await bob.get(`/api/posts/${p.id}`)).body.post.likeCount).toBe(25);
    // and back down
    await Promise.all(fans.slice(0, 10).map((f) => f.send("delete", `/api/posts/${p.id}/like`)));
    expect((await bob.get(`/api/posts/${p.id}`)).body.post.likeCount).toBe(15);
  });

  it("when a hot post's counts expire, 60 simultaneous readers cause ONE recount, not 60", async () => {
    const p = await alice.post("hot");
    await Promise.all(fans.slice(0, 5).map((f) => f.send("put", `/api/posts/${p.id}/like`)));
    const { redis } = await import("./infra/redis.js");
    const { counterValues, dbLoads } = await import("./infra/metrics.js");
    await redis.del(`post:${p.id}:stats`);
    const before = (await counterValues(dbLoads)).stats ?? 0;
    const rs = await Promise.all(Array.from({ length: 60 }, (_x, i) => fans[i % fans.length]!.get(`/api/posts/${p.id}`)));
    expect(rs.every((r) => r.status === 200 && r.body.post.likeCount === 5)).toBe(true);
    expect(((await counterValues(dbLoads)).stats ?? 0) - before).toBe(1);
  });
});

describe("merged like notifications", () => {
  it("many likes become ONE notification row: 'fan7 and 7 others' with the 3 latest names", async () => {
    const p = await carol.post("for the fans");
    const likers = fans.slice(0, 8);
    for (const f of likers) await f.send("put", `/api/posts/${p.id}/like`); // in order, so "newest" is well defined
    const rows = async () => (await owner((c) => c.query("select * from notifications where recipient_id = $1 and type = 'like' and post_id = $2", [carol.user!.id, p.id]))).rows;
    await waitFor(async () => (await rows())[0]?.actor_count === 8, 20000, "8 likes merged");
    expect(await rows()).toHaveLength(1);
    const list = (await carol.get("/api/notifications")).body.notifications;
    const n = list.find((x: { type: string; post: { id: string } | null }) => x.type === "like" && x.post?.id === p.id);
    expect(n.total).toBe(8);
    const names = n.actors.map((a: { username: string }) => a.username);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const x of names) expect(likers.map((f) => f.user!.username)).toContain(x);
  });

  it("counts people, not likes: liking, unliking and liking again is still one person", async () => {
    const p = await carol.post("fickle");
    const row = async () => (await owner((c) => c.query("select actor_count from notifications where post_id = $1 and type = 'like'", [p.id]))).rows[0];
    for (let i = 0; i < 3; i++) {
      await bob.send("put", `/api/posts/${p.id}/like`);
      await bob.send("delete", `/api/posts/${p.id}/like`);
    }
    await bob.send("put", `/api/posts/${p.id}/like`);
    await alice.send("put", `/api/posts/${p.id}/like`);
    const unpublished = async () => (await owner((c) => c.query("select 1 from outbox where type = 'like.created' and payload->>'postId' = $1 and notified_at is null", [p.id]))).rowCount;
    await waitFor(async () => (await unpublished()) === 0, 20000, "all like events merged");
    expect((await row()).actor_count).toBe(2);
  });

  it("is exactly-once: re-running the same event (a retried job) doesn't count it twice", async () => {
    const p = await carol.post("retry me");
    await bob.send("put", `/api/posts/${p.id}/like`);
    const row = async () => (await owner((c) => c.query("select actor_count from notifications where post_id = $1 and type = 'like'", [p.id]))).rows[0];
    await waitFor(async () => (await row())?.actor_count === 1, 20000, "like merged");
    const ev = await owner((c) => c.query<{ id: string }>("select id::text from outbox where type = 'like.created' and payload->>'postId' = $1", [p.id]));
    const { notifyJob } = await import("./jobs/notify.js");
    const job = { name: "like.created", data: { eventId: ev.rows[0]!.id, postId: p.id, userId: bob.user!.id, postAuthorId: carol.user!.id } } as never;
    await notifyJob(job); await notifyJob(job);
    expect((await row()).actor_count).toBe(1);
  });
});

describe("rate limits", () => {
  const scale = async (n: number) => (await import("./lib/limits.js")).setLimitScale(n);
  afterAll(() => scale(1000));

  it("likes: a burst of 30 is fine, the 31st is refused with Retry-After; someone else isn't affected", async () => {
    await scale(1);
    const p = await alice.post("limit me");
    const results: number[] = [];
    for (let i = 0; i < 31; i++) results.push((await bob.send(i % 2 ? "delete" : "put", `/api/posts/${p.id}/like`)).status);
    expect(results.slice(0, 30).every((s) => s === 200)).toBe(true);
    const last = await bob.send("put", `/api/posts/${p.id}/like`);
    expect(last.status).toBe(429);
    expect(Number(last.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(last.body.error).toMatch(/too fast/);
    expect((await carol.send("put", `/api/posts/${p.id}/like`)).status).toBe(200);
    await scale(1000);
  });

  it("login: guesses for one account spread over many IPs are still stopped (per-account limit)", async () => {
    await scale(1);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const c = await new Client(app).init();
      c.ip = `198.51.100.${i + 1}`;
      statuses.push((await c.send("post", "/api/auth/login", { email: "alice@example.com", password: `guess-${i}` })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    await scale(1000);
  });

  it("Redis down: likes still work (fail open), login is refused (fail closed)", async () => {
    const { limitsRedis } = await import("./infra/redis.js");
    const p = await alice.post("redis down");
    limitsRedis.disconnect();
    try {
      expect((await bob.send("put", `/api/posts/${p.id}/like`)).status).toBe(200);
      const c = await new Client(app).init();
      const r = await c.send("post", "/api/auth/login", { email: "alice@example.com", password: "correct horse battery" });
      expect(r.status).toBe(503);
    } finally {
      await limitsRedis.connect();
    }
    const c = await new Client(app).init();
    expect((await c.send("post", "/api/auth/login", { email: "carol@example.com", password: "correct horse battery" })).status).toBe(200);
  });
});

describe("upload cleanup", () => {
  const run = async (name: string, data: object = {}) => (await import("./jobs/maintenance.js")).maintenanceJob({ name, data } as never);
  const { mediaFiles } = { mediaFiles: async (id: string) => {
    const { listObjects, BUCKETS } = await import("./infra/storage.js");
    const out: string[] = [];
    for await (const o of listObjects(BUCKETS.media, `${id}/`)) out.push(o.key);
    return out;
  } };

  it("unused uploads: marked, then files deleted, then the row; media in a post is never touched", async () => {
    const unused = await bob.upload(await pngBuffer("#aa0000"));
    const p = await bob.post("keep my photo");
    const used = (await owner((c) => c.query<{ media_id: string }>("select media_id from post_media where post_id = $1", [p.id]))).rows[0]!.media_id;
    expect((await mediaFiles(unused.id)).length).toBeGreaterThan(0);
    await owner((c) => c.query("update media set created_at = now() - interval '2 days' where id = any($1::uuid[])", [[unused.id, used]]));

    const r = await run("media.abandoned", { graceMs: 0 });
    expect(r).toMatchObject({ deleted: 1, failed: 0 });
    expect((await owner((c) => c.query("select 1 from media where id = $1", [unused.id]))).rowCount).toBe(0);
    expect(await mediaFiles(unused.id)).toEqual([]);
    expect((await owner((c) => c.query<{ status: string }>("select status from media where id = $1", [used]))).rows[0]!.status).toBe("ready");
    expect((await mediaFiles(used)).length).toBeGreaterThan(0);
  });

  it("a row marked for deletion that something started using is put back, files intact", async () => {
    const p = await bob.post("raced");
    const id = (await owner((c) => c.query<{ media_id: string }>("select media_id from post_media where post_id = $1", [p.id]))).rows[0]!.media_id;
    await owner((c) => c.query("update media set status = 'deleting', deleting_since = now() - interval '1 hour' where id = $1", [id]));
    expect(await run("media.abandoned", { graceMs: 0 })).toMatchObject({ restored: 1 });
    expect((await owner((c) => c.query<{ status: string }>("select status from media where id = $1", [id]))).rows[0]!.status).toBe("ready");
    expect((await mediaFiles(id)).length).toBeGreaterThan(0);
  });

  it("media marked for deletion can't be put into a post", async () => {
    const m = await bob.upload(await pngBuffer("#00aa00"));
    await owner((c) => c.query("update media set status = 'deleting', deleting_since = now() where id = $1", [m.id]));
    const r = await bob.send("post", "/api/posts", { mediaIds: [m.id], caption: "too late" }, { "Idempotency-Key": key() });
    expect(r.status).toBe(400);
  });

  it("weekly storage check: deletes files the database doesn't know about, keeps the rest", async () => {
    const { putPublic, s3, BUCKETS } = await import("./infra/storage.js");
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const ghost = randomUUID();
    await putPublic(`${ghost}/w640.webp`, Buffer.from("orphan"));
    await s3.send(new PutObjectCommand({ Bucket: BUCKETS.uploads, Key: `incoming/${bob.user!.id}/${randomUUID()}`, Body: Buffer.from("orphan original") }));
    const p = await bob.post("real");
    const real = (await owner((c) => c.query<{ media_id: string }>("select media_id from post_media where post_id = $1", [p.id]))).rows[0]!.media_id;

    const r = await run("storage.reconcile", { minAgeMs: 0 });
    expect(r.orphansDeleted).toBeGreaterThanOrEqual(2);
    expect(await mediaFiles(ghost)).toEqual([]);
    expect((await mediaFiles(real)).length).toBeGreaterThan(0);
    const { redis } = await import("./infra/redis.js");
    expect(JSON.parse((await redis.get("ops:storage-reconcile"))!).orphansDeleted).toBe(r.orphansDeleted);
  });
});
