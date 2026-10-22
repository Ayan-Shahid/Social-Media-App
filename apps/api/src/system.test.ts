// System-design tests: outbox reliability, idempotent consumers, hybrid fan-out, caching,
// write-through counters, and two real API processes sharing realtime + rate limits through Redis.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import request from "supertest";
import { io as ioc, type Socket } from "socket.io-client";
import type { Express } from "express";
import { Client, asDb, key, resetAll, waitFor } from "./test/harness.js";

let app: Express;
let workers: Awaited<ReturnType<typeof import("./worker.js")["startWorkers"]>> | null = null;
let redis: typeof import("./infra/redis.js")["redis"];
let alice: Client, bob: Client, carol: Client, dave: Client, star: Client;
const startWorkers = async () => { workers = (await import("./worker.js")).startWorkers(); };
const stopWorkers = async () => { await workers?.close(); workers = null; };

beforeAll(async () => {
  await resetAll();
  app = (await import("./app.js")).createApp();
  redis = (await import("./infra/redis.js")).redis;
  await startWorkers();
  [alice, bob, carol, dave, star] = await Promise.all(["alice", "bob", "carol", "dave", "star"].map(async (u) => (await new Client(app).init()).register(u)));
});

afterAll(async () => {
  await stopWorkers();
  await (await import("./infra/queues.js")).closeQueues();
  await (await import("./db/worker-pool.js")).closeWorkerPool();
  redis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

const unpublished = () => asDb(process.env.MIGRATION_DATABASE_URL!, null, (c) => c.query<{ n: number }>("select count(*)::int as n from outbox where published_at is null")).then((r) => r.rows[0]!.n);
const notificationsFor = (userId: string) => asDb(process.env.MIGRATION_DATABASE_URL!, null, (c) => c.query("select * from notifications where recipient_id = $1", [userId])).then((r) => r.rows);
const inFeed = (userId: string, postId: string) => redis.zscore(`feed:${userId}`, `p|${postId}`);

describe("transactional outbox", () => {
  it("events written while workers are down are delivered when they come back: nothing is lost", async () => {
    const p = await alice.post("outbox test");
    await stopWorkers();
    for (const c of [bob, carol, dave]) expect((await c.send("put", `/api/posts/${p.id}/like`)).status).toBe(200);
    expect(await unpublished()).toBeGreaterThanOrEqual(3); // sitting safely in Postgres
    const before = (await notificationsFor(alice.user!.id)).length;
    await startWorkers();
    await waitFor(async () => (await unpublished()) === 0, 20000, "outbox drained");
    await waitFor(async () => (await notificationsFor(alice.user!.id)).length >= before + 3, 20000, "notifications");
  });

  it("a rolled-back change produces no event", async () => {
    const before = await asDb(process.env.MIGRATION_DATABASE_URL!, null, (c) => c.query<{ n: number }>("select count(*)::int as n from outbox")).then((r) => r.rows[0]!.n);
    // Commenting on a post that doesn't exist fails inside the transaction, before commit.
    const r = await bob.send("post", `/api/posts/00000000-0000-4000-8000-000000000000/comments`, { body: "hi" }, { "Idempotency-Key": key() });
    expect(r.status).toBe(404);
    const after = await asDb(process.env.MIGRATION_DATABASE_URL!, null, (c) => c.query<{ n: number }>("select count(*)::int as n from outbox")).then((r) => r.rows[0]!.n);
    expect(after).toBe(before);
  });

  it("consumers are idempotent: the same event processed twice notifies once", async () => {
    const { notifyJob } = await import("./jobs/notify.js");
    const job = { name: "follow.created", data: { eventId: "test-dup-1", followerId: carol.user!.id, followeeId: dave.user!.id } } as never;
    await notifyJob(job);
    await notifyJob(job);
    const rows = (await notificationsFor(dave.user!.id)).filter((n) => n.event_id === "test-dup-1");
    expect(rows).toHaveLength(1);
  });
});

describe("hybrid fan-out feed (threshold = 3 followers in tests)", () => {
  it("a normal account's post is pushed into followers' timelines", async () => {
    await bob.follow(carol.user!.id);
    await bob.get("/api/posts/feed"); // creates bob's timeline
    const p = await carol.post("pushed");
    await waitFor(async () => (await inFeed(bob.user!.id, p.id)) !== null, 10000, "fan-out push");
    const feed = await bob.get("/api/posts/feed");
    expect(feed.body.posts.map((x: { id: string }) => x.id)).toContain(p.id);
  });

  it("a big account's post is NOT pushed, but is pulled into the feed at read time", async () => {
    for (const c of [alice, bob, carol]) await c.follow(star.user!.id); // star now has 3 followers = threshold
    await alice.get("/api/posts/feed");
    const p = await star.post("pulled");
    await new Promise((r) => setTimeout(r, 1500)); // give fan-out a chance to (wrongly) push
    expect(await inFeed(alice.user!.id, p.id)).toBeNull();
    await redis.del(`feed:pull:${alice.user!.id}`); // follow list cache
    const feed = await alice.get("/api/posts/feed");
    expect(feed.body.posts.map((x: { id: string }) => x.id)).toContain(p.id);
    expect(feed.body.source.pulled).toBeGreaterThan(0);
  });

  it("a lost timeline (Redis restart) is rebuilt from Postgres", async () => {
    const p = await carol.post("survives a flush");
    await waitFor(async () => (await inFeed(bob.user!.id, p.id)) !== null, 10000, "push");
    await redis.del(`feed:${bob.user!.id}`);
    const feed = await bob.get("/api/posts/feed");
    expect(feed.body.posts.map((x: { id: string }) => x.id)).toContain(p.id);
    expect(await redis.exists(`feed:${bob.user!.id}`)).toBe(1);
  });

  it("reposts are pushed to the reposter's followers, labelled, and hidden again after unfollowing", async () => {
    const p = await dave.post("dave's photo");
    await alice.follow(bob.user!.id);
    await alice.get("/api/posts/feed"); // make sure alice's timeline exists
    const r = await bob.send("put", `/api/posts/${p.id}/repost`);
    expect(r.body.repostCount).toBe(1);
    await waitFor(async () => (await redis.zscore(`feed:${alice.user!.id}`, `r|${p.id}|${bob.user!.id}`)) !== null, 10000, "repost pushed");
    const feed = await alice.get("/api/posts/feed");
    expect(feed.body.posts.find((x: { id: string }) => x.id === p.id)?.repostedBy?.username).toBe("bob");
    expect((await bob.send("put", `/api/posts/${p.id}/repost`)).body.repostCount).toBe(1); // repeat = no-op
    await alice.send("delete", `/api/users/${bob.user!.id}/follow`);
    const after = await alice.get("/api/posts/feed");
    expect(after.body.posts.find((x: { id: string }) => x.id === p.id)).toBeUndefined();
  });
});

describe("caching", () => {
  it("500 concurrent requests for one cold post cause ONE database load (stampede protection)", async () => {
    const { dbLoads } = await import("./infra/metrics.js");
    const p = await alice.post("hot post");
    await redis.del(`post:${p.id}`);
    const before = (await dbLoads.get()).values.find((v) => v.labels.cache === "post")?.value ?? 0;
    const results = await Promise.all(Array.from({ length: 500 }, () => bob.get(`/api/posts/${p.id}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const after = (await dbLoads.get()).values.find((v) => v.labels.cache === "post")?.value ?? 0;
    expect(after - before).toBe(1);
  });

  it("deleting a post removes it from the cache immediately", async () => {
    const p = await alice.post("short-lived");
    expect((await bob.get(`/api/posts/${p.id}`)).status).toBe(200); // now cached
    expect(await redis.exists(`post:${p.id}`)).toBe(1);
    await alice.send("delete", `/api/posts/${p.id}`);
    expect((await bob.get(`/api/posts/${p.id}`)).status).toBe(404);
  });

  it("per-viewer flags are never stored in shared cache entries", async () => {
    const p = await alice.post("flags");
    await bob.send("put", `/api/posts/${p.id}/like`);
    const asBob = await bob.get(`/api/posts/${p.id}`);
    const asCarol = await carol.get(`/api/posts/${p.id}`);
    expect(asBob.body.post.likedByMe).toBe(true);
    expect(asCarol.body.post.likedByMe).toBe(false);
    const raw = await redis.get(`post:${p.id}`);
    expect(raw).not.toMatch(/likedByMe|savedByMe/);
  });

  it("counters are write-through, and a wrong count repairs itself from Postgres", async () => {
    const p = await alice.post("counts");
    await bob.get(`/api/posts/${p.id}`); // warm stats hash
    await bob.send("put", `/api/posts/${p.id}/like`);
    await carol.send("put", `/api/posts/${p.id}/like`);
    expect(await redis.hget(`post:${p.id}:stats`, "likes")).toBe("2");
    await redis.hset(`post:${p.id}:stats`, "likes", 999); // simulate drift
    await redis.del(`post:${p.id}:stats`); // the 1 h expiry, fast-forwarded
    expect((await bob.get(`/api/posts/${p.id}`)).body.post.likeCount).toBe(2);
  });
});

describe("two API processes behind one Redis", () => {
  const procs: ChildProcess[] = [];
  const env = (port: number, id: string) => ({ ...process.env, PORT: String(port), INSTANCE_ID: id, NODE_ENV: "test" });
  const startApi = (port: number, id: string) => new Promise<void>((resolve, reject) => {
    const p = spawn("node", ["dist/server.js"], { env: env(port, id), stdio: ["ignore", "pipe", "pipe"] });
    procs.push(p);
    p.stdout!.on("data", (d) => { if (String(d).includes(`on :${port}`)) resolve(); });
    p.stderr!.on("data", (d) => process.stderr.write(d));
    p.on("exit", (c) => reject(new Error(`api exited ${c}`)));
    setTimeout(() => reject(new Error("api start timeout")), 15000);
  });
  const A = "http://localhost:4701", B = "http://localhost:4702";

  beforeAll(async () => {
    execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { stdio: "inherit" });
    await Promise.all([startApi(4701, "api-1"), startApi(4702, "api-2")]);
  });
  afterAll(() => { for (const p of procs) p.kill("SIGTERM"); });

  async function login(base: string, email: string) {
    const agent = request.agent(base);
    const csrfRes = await agent.get("/api/auth/csrf");
    const csrf = /glimpse_csrf=([^;]+)/.exec(String(csrfRes.headers["set-cookie"]))![1]!;
    const r = await agent.post("/api/auth/login").set("Origin", "http://localhost:3000").set("X-CSRF-Token", csrf).send({ email, password: "correct horse battery" });
    const cookies = (r.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
    const csrf2 = /glimpse_csrf=([^;]+)/.exec(String(r.headers["set-cookie"]))![1]!;
    return { agent, cookies, csrf: csrf2 };
  }

  it("a message sent through instance 2 reaches a user connected to instance 1, live", async () => {
    const b = await login(A, "bob@example.com");
    const a = await login(B, "alice@example.com");
    const socket: Socket = ioc(A, { path: "/socket.io", transports: ["websocket"], extraHeaders: { Cookie: b.cookies, Origin: "http://localhost:3000" } });
    const hello = await new Promise<{ instance: string }>((r) => socket.once("hello", r));
    expect(hello.instance).toBe("api-1");
    const got = new Promise<{ ciphertext: string }>((r) => socket.on("message:new", r));
    const conv = await a.agent.post("/api/conversations").set("Origin", "http://localhost:3000").set("X-CSRF-Token", a.csrf).send({ userId: bob.user!.id });
    const sent = await a.agent.post(`/api/conversations/${conv.body.conversation.id}/messages`).set("Origin", "http://localhost:3000").set("X-CSRF-Token", a.csrf)
      .set("Idempotency-Key", key()).send({ ciphertext: "Q".repeat(40), nonce: "N".repeat(32) });
    expect(sent.headers["x-served-by"]).toBe("api-2");
    const m = await Promise.race([got, new Promise<never>((_, j) => setTimeout(() => j(new Error("no live message")), 5000))]);
    expect(m.ciphertext).toBe("Q".repeat(40));
    socket.disconnect();
  });

  it("presence is shared: a user connected to instance 1 shows as online when asked on instance 2", async () => {
    const b = await login(A, "bob@example.com");
    const a = await login(B, "alice@example.com");
    const sb: Socket = ioc(A, { path: "/socket.io", transports: ["websocket"], extraHeaders: { Cookie: b.cookies, Origin: "http://localhost:3000" } });
    await new Promise((r) => sb.once("hello", r));
    const sa: Socket = ioc(B, { path: "/socket.io", transports: ["websocket"], extraHeaders: { Cookie: a.cookies, Origin: "http://localhost:3000" } });
    await new Promise((r) => sa.once("hello", r));
    const online = await new Promise<string[]>((r) => sa.emit("presence:query", [bob.user!.id, carol.user!.id], r));
    expect(online).toEqual([bob.user!.id]);
    sb.disconnect(); sa.disconnect();
  });

  it("a WebSocket from another website is refused", async () => {
    const b = await login(A, "bob@example.com");
    const s: Socket = ioc(A, { path: "/socket.io", transports: ["websocket"], reconnection: false, extraHeaders: { Cookie: b.cookies, Origin: "https://evil.example" } });
    const err = await new Promise((r) => s.once("connect_error", r));
    expect(err).toBeTruthy();
    s.disconnect();
  });

  it("the login rate limit is shared: 10 tries across both instances, then blocked on either", async () => {
    const ip = "203.0.113.77";
    const tryLogin = async (base: string) => {
      const agent = request.agent(base);
      const c = await agent.get("/api/auth/csrf").set("X-Forwarded-For", ip);
      const csrf = /glimpse_csrf=([^;]+)/.exec(String(c.headers["set-cookie"]))![1]!;
      return agent.post("/api/auth/login").set("X-Forwarded-For", ip).set("Origin", "http://localhost:3000").set("X-CSRF-Token", csrf).send({ email: "x@example.com", password: "wrong-password" });
    };
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await tryLogin(i % 2 ? A : B)).status);
    expect(statuses.every((s) => s === 401)).toBe(true);
    expect((await tryLogin(A)).status).toBe(429);
    expect((await tryLogin(B)).status).toBe(429);
  });
});

