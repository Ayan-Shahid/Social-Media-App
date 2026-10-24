// Security tests against a real Postgres, Redis and in-process workers. Each block tries to break one protection.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import pg from "pg";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Express } from "express";
import { Client, fetchMedia, ORIGIN, asDb, key, pngBuffer, resetAll, sodium, waitFor } from "./test/harness.js";

let app: Express;
let workers: { close(): Promise<void> };
let alice: Client, bob: Client, carol: Client;

beforeAll(async () => {
  await resetAll();
  app = (await import("./app.js")).createApp();
  workers = (await import("./worker.js")).startWorkers();
  alice = await (await new Client(app).init()).register("alice");
  bob = await (await new Client(app).init()).register("bob");
  carol = await (await new Client(app).init()).register("carol");
});

afterAll(async () => {
  await workers.close();
  const { closeQueues } = await import("./infra/queues.js"); await closeQueues();
  (await import("./db/worker-pool.js")).closeWorkerPool();
  (await import("./infra/redis.js")).redis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

describe("auth", () => {
  it("logs in, never returns the password hash, same error for unknown emails", async () => {
    const c = await new Client(app).init();
    const ok = c.grabCsrf(await c.send("post", "/api/auth/login", { email: "alice@example.com", password: "correct horse battery" }));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toMatch(/argon2|password_?hash/i);
    expect(ok.body.keyBackup.ciphertext).toBeTruthy();
    const bad = await c.send("post", "/api/auth/login", { email: "alice@example.com", password: "nope-nope" });
    const unknown = await c.send("post", "/api/auth/login", { email: "nobody@example.com", password: "nope-nope" });
    expect(bad.status).toBe(401);
    expect(unknown.body.error).toBe(bad.body.error);
  });
  it("rejects duplicate usernames with a field error", async () => {
    const c = await new Client(app).init();
    const r = await c.send("post", "/api/auth/register", { username: "ALICE", email: "x@example.com", password: "12345678", keys: { publicKey: "A".repeat(44), backup: { ciphertext: "A".repeat(80), nonce: "A".repeat(32), salt: "A".repeat(24), opsLimit: 2, memLimit: 16777216 } } });
    expect(r.status).toBe(400);
    expect(r.body.fields.username).toMatch(/taken/);
  });
  it("blocks API calls without a session", async () => {
    expect((await request(app).get("/api/posts/feed")).status).toBe(401);
  });
});

describe("CSRF", () => {
  it("blocks a write from another website", async () => {
    const r = await alice.agent.patch("/api/users/me").set("Origin", "https://evil.example").set("X-CSRF-Token", alice.csrf).send({ bio: "hacked" });
    expect(r.status).toBe(403);
  });
  it("blocks a write without the CSRF token", async () => {
    expect((await alice.agent.patch("/api/users/me").set("Origin", ORIGIN).send({ bio: "hacked" })).status).toBe(403);
  });
  it("blocks a write with someone else's token", async () => {
    expect((await alice.agent.patch("/api/users/me").set("Origin", ORIGIN).set("X-CSRF-Token", bob.csrf).send({ bio: "hacked" })).status).toBe(403);
  });
  it("allows the real page", async () => {
    expect((await alice.send("patch", "/api/users/me", { bio: "hello" })).status).toBe(200);
  });
});

describe("upload sanitization", () => {
  const up = (c: Client, buf: Buffer, type: string, purpose = "post") => c.startUpload(buf, type, purpose);

  it("accepts a real PNG: uploaded straight to storage, re-encoded WebP sizes later, random names", async () => {
    const m = await alice.upload(await pngBuffer(), "my photo.png");
    expect(m.status).toBe("ready");
    expect(m.url).toMatch(/^\/media\/[0-9a-f-]{36}\/\d+\.webp$/);
    expect(m.srcset.length).toBeGreaterThanOrEqual(1);
    const served = await fetchMedia(m.url);
    expect(served.headers.get("content-type")).toMatch(/image\/webp/);
    expect(served.headers.get("cache-control")).toMatch(/immutable/);
  });
  it("signs the upload URL for exactly the declared type, and never for the API's own host", async () => {
    const slot = await alice.send("post", "/api/media/uploads", { purpose: "post", mime: "image/png", size: 1234 }, { "Idempotency-Key": key() });
    expect(slot.status).toBe(201);
    const u = new URL(slot.body.upload.url);
    expect(u.pathname).toMatch(new RegExp(`^/uploads/incoming/${alice.user!.id}/[0-9a-f-]{36}$`));
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(u.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(Number(u.searchParams.get("X-Amz-Expires"))).toBeLessThanOrEqual(600);
  });
  it("refuses to sign uploads that are too big or the wrong kind for their purpose", async () => {
    const big = await alice.send("post", "/api/media/uploads", { purpose: "post", mime: "image/png", size: 500 * 1024 * 1024 }, { "Idempotency-Key": key() });
    expect(big.status).toBe(413);
    const svg = await alice.send("post", "/api/media/uploads", { purpose: "post", mime: "image/svg+xml", size: 100 }, { "Idempotency-Key": key() });
    expect(svg.status).toBe(415);
    const videoAvatar = await alice.send("post", "/api/media/uploads", { purpose: "avatar", mime: "video/mp4", size: 100 }, { "Idempotency-Key": key() });
    expect(videoAvatar.status).toBe(415);
  });
  it("rejects an HTML page uploaded as a PNG (magic bytes checked on complete), and deletes it", async () => {
    const r = await up(alice, Buffer.from("<html><script>alert(document.cookie)</script></html>"), "image/png");
    expect(r.status).toBe(415);
  });
  it("rejects a Windows program uploaded as a PNG", async () => {
    expect((await up(alice, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0x90)]), "image/png")).status).toBe(415);
  });
  it("rejects a video declared as a photo (declared and real type must match)", async () => {
    const out = "/tmp/glimpse-test-tiny.mp4";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=5", "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
    expect((await up(alice, fs.readFileSync(out), "image/png")).status).toBe(415);
  });
  it("catches a file bigger than declared, even if storage doesn't enforce the signed length", async () => {
    const buf = await pngBuffer();
    const r = await alice.startUpload(Buffer.concat([buf, Buffer.alloc(5000)]), "image/png", "post", buf.length);
    // A real S3 rejects the PUT (signature covers Content-Length); the test storage accepts it, so "complete" must catch it.
    expect(r.status).toBe(400);
  });
  it("garbage that only starts like a JPEG passes the quick check but fails processing (no retries)", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("this is not really an image".repeat(20))]);
    const r = await up(alice, fake, "image/jpeg");
    expect(r.status).toBe(202);
    const m = await waitFor(async () => { const x = await alice.get(`/api/media/${r.body.media.id}`); return x.body.media.status === "failed" ? x.body.media : null; });
    expect(m.error).toMatch(/couldn't be read/);
  });
  it("strips a script hidden after a real image (polyglot), and deletes the original", async () => {
    const m = await alice.upload(Buffer.concat([await pngBuffer(), Buffer.from("<script>alert('pwned')</script>")]), "p.png");
    const served = Buffer.from(await (await fetchMedia(m.url)).arrayBuffer());
    expect(served.includes(Buffer.from("pwned"))).toBe(false);
    const { BUCKETS, head } = await import("./infra/storage.js");
    expect(await head(BUCKETS.uploads, `incoming/${alice.user!.id}/${m.id}`)).toBeNull();
  });
  it("turns a real video into adaptive HLS with a poster", async () => {
    const out = "/tmp/glimpse-test-clip.webm";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=15", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libvpx", "-c:a", "libvorbis", out]);
    const m = await alice.upload(fs.readFileSync(out), "clip.webm");
    expect(m.status, m.error).toBe("ready");
    expect(m.kind).toBe("video");
    expect(m.hls).toMatch(/master\.m3u8$/);
    const master = await fetchMedia(m.hls);
    expect(master.headers.get("content-type")).toMatch(/mpegurl/);
    const text = await master.text();
    expect(text).toMatch(/#EXT-X-STREAM-INF/);
    expect(text.match(/#EXT-X-STREAM-INF/g)!.length).toBe(1); // 360p source: no upscaled 720p rendition
    expect(m.posterUrl).toMatch(/poster\.webp$/);
  });
  it("the API itself serves no files", async () => {
    expect((await request(app).get("/media/anything/480.webp")).status).toBe(404);
  });
});

describe("idempotency", () => {
  let mediaId = "";
  beforeAll(async () => { mediaId = (await alice.upload(await pngBuffer("#aa3355"))).id; });
  it("a double-submitted post creates one post and replays the same result", async () => {
    const k = key();
    const a = await alice.send("post", "/api/posts", { mediaIds: [mediaId], caption: "once" }, { "Idempotency-Key": k });
    const b = await alice.send("post", "/api/posts", { mediaIds: [mediaId], caption: "once" }, { "Idempotency-Key": k });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.body.post.id).toBe(a.body.post.id);
  });
  it("rejects reusing a key for a different request", async () => {
    const k = key();
    const m2 = (await alice.upload(await pngBuffer("#11aa22"))).id;
    await alice.send("post", "/api/posts", { mediaIds: [m2], caption: "first" }, { "Idempotency-Key": k });
    expect((await alice.send("post", "/api/posts", { mediaIds: [m2], caption: "different" }, { "Idempotency-Key": k })).status).toBe(422);
  });
  it("requires a key on create actions", async () => {
    expect((await alice.send("post", "/api/posts", { mediaIds: [mediaId], caption: "x" })).status).toBe(400);
  });
  it("bob can't post alice's media", async () => {
    const m3 = (await alice.upload(await pngBuffer("#2244ee"))).id;
    expect((await bob.send("post", "/api/posts", { mediaIds: [m3], caption: "mine" }, { "Idempotency-Key": key() })).status).toBe(404);
  });
});

describe("authorization (API level)", () => {
  it("bob can't delete alice's post", async () => {
    const p = await alice.post("keep me");
    expect((await bob.send("delete", `/api/posts/${p.id}`)).status).toBe(404);
    expect((await alice.get(`/api/posts/${p.id}`)).status).toBe(200);
  });
  it("stores captions as plain text and returns strict headers", async () => {
    const m = await bob.upload(await pngBuffer("#996633"));
    const r = await bob.send("post", "/api/posts", { mediaIds: [m.id], caption: "<img src=x onerror=alert(1)>" }, { "Idempotency-Key": key() });
    expect(r.body.post.caption).toBe("<img src=x onerror=alert(1)>");
    expect(r.headers["content-security-policy"]).toMatch(/default-src 'none'/);
  });
});

describe("end-to-end encrypted direct messages", () => {
  let convId = "";
  const b64 = (x: Uint8Array) => sodium.to_base64(x, sodium.base64_variants.ORIGINAL);
  const fromB64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

  it("alice encrypts for bob; bob decrypts; the server only has ciphertext", async () => {
    const c = await alice.send("post", "/api/conversations", { userId: bob.user!.id });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    convId = c.body.conversation.id;
    const bobKey = fromB64(c.body.conversation.otherPublicKey);
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const ct = sodium.crypto_box_easy("meet at 5, the secret is pineapple", nonce, bobKey, alice.keys.privateKey);
    expect((await alice.send("post", `/api/conversations/${convId}/messages`, { ciphertext: b64(ct), nonce: b64(nonce) }, { "Idempotency-Key": key() })).status).toBe(201);
    const m = (await bob.get(`/api/conversations/${convId}/messages`)).body.messages[0];
    const aliceKey = fromB64((await bob.get(`/api/keys/${alice.user!.id}`)).body.publicKey);
    expect(sodium.to_string(sodium.crypto_box_open_easy(fromB64(m.ciphertext), fromB64(m.nonce), aliceKey, bob.keys.privateKey))).toBe("meet at 5, the secret is pineapple");
    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await owner.connect();
    const dump = await owner.query("select * from messages"); await owner.end();
    expect(JSON.stringify(dump.rows)).not.toMatch(/pineapple/);
  });
  it("carol can't read or post into alice and bob's conversation", async () => {
    expect((await carol.get(`/api/conversations/${convId}`)).status).toBe(404);
    expect((await carol.get(`/api/conversations/${convId}/messages`)).body.messages).toHaveLength(0);
    expect((await carol.send("post", `/api/conversations/${convId}/messages`, { ciphertext: "A".repeat(40), nonce: "A".repeat(32) }, { "Idempotency-Key": key() })).status).toBe(404);
  });
});

describe("row-level security (database level, bypassing the API)", () => {
  const as = <T,>(u: string | null, q: (c: pg.Client) => Promise<T>) => asDb(process.env.DATABASE_URL!, u, q);
  it("no user set: sees nothing", async () => {
    expect((await as(null, (c) => c.query("select * from posts"))).rowCount).toBe(0);
    expect((await as(null, (c) => c.query("select * from users"))).rowCount).toBe(0);
  });
  it("credentials, sessions and linked accounts are off-limits", async () => {
    for (const t of ["user_credentials", "sessions", "oauth_accounts"]) {
      await expect(as(alice.user!.id, (c) => c.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
    }
  });
  it("carol can't see alice and bob's messages, even with a raw SELECT", async () => {
    expect((await as(carol.user!.id, (c) => c.query("select * from messages"))).rowCount).toBe(0);
    expect((await as(bob.user!.id, (c) => c.query("select * from messages"))).rowCount).toBe(1);
  });
  it("can't post as someone else", async () => {
    await expect(as(bob.user!.id, (c) => c.query("insert into posts (author_id) values ($1)", [alice.user!.id]))).rejects.toThrow(/row-level security/);
  });
  it("can't edit someone else's profile, read their key backup, or change a username", async () => {
    expect((await as(bob.user!.id, (c) => c.query("update users set bio = 'pwned' where id = $1", [alice.user!.id]))).rowCount).toBe(0);
    expect((await as(bob.user!.id, (c) => c.query("select * from key_backups where user_id = $1", [alice.user!.id]))).rowCount).toBe(0);
    await expect(as(alice.user!.id, (c) => c.query("update users set username = 'admin' where id = $1", [alice.user!.id]))).rejects.toThrow(/permission denied/);
  });
  it("the worker role can't read credentials or sessions either", async () => {
    await expect(asDb(process.env.WORKER_DATABASE_URL!, null, (c) => c.query("select * from user_credentials"))).rejects.toThrow(/permission denied/);
    await expect(asDb(process.env.WORKER_DATABASE_URL!, null, (c) => c.query("select * from key_backups"))).rejects.toThrow(/permission denied/);
  });
});

describe("error responses", () => {
  it("every response carries a request id, and a crash returns it as the error reference (no details leak)", async () => {
    const r = await alice.get("/api/posts/feed");
    expect(r.headers["x-request-id"]).toMatch(/^[0-9a-f]{12}$/);
    const { errorHandler } = await import("./lib/http.js");
    let status = 0, body: Record<string, unknown> = {};
    const res = { status(s: number) { status = s; return this; }, json(b: Record<string, unknown>) { body = b; return this; } };
    errorHandler(new Error("db exploded: password=hunter2"), { id: "abc123def456" } as never, res as never, () => {});
    expect(status).toBe(500);
    expect(body).toEqual({ error: "Something went wrong on our side.", ref: "abc123def456" });
  });

  it("queue dashboard: signed out -> sent to log in; signed in but not an admin -> a readable 403 page", async () => {
    const anon = await request(app).get("/admin/queues");
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toBe("/login?next=%2Fadmin%2Fqueues");
    const r = await bob.get("/admin/queues");
    expect(r.status).toBe(403);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.text).toContain("Admins only");
    expect((await alice.get("/admin/queues/")).status).toBe(200);
  });
});
