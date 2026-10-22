// Security tests against a real Postgres, Redis and in-process workers. Each block tries to break one protection.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import pg from "pg";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import type { Express } from "express";
import { Client, ORIGIN, asDb, key, pngBuffer, resetAll, sodium, waitFor } from "./test/harness.js";

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
  const up = (c: Client, buf: Buffer, name: string, type: string, purpose = "post") =>
    c.send("post", `/api/media?purpose=${purpose}`, undefined, { "Idempotency-Key": key() }).attach("file", buf, { filename: name, contentType: type });

  it("accepts a real PNG: 202 now, re-encoded WebP sizes later, random names", async () => {
    const m = await alice.upload(await pngBuffer(), "my photo.png");
    expect(m.status).toBe("ready");
    expect(m.url).toMatch(/^\/media\/[0-9a-f-]{36}\/\d+\.webp$/);
    expect(m.srcset.length).toBeGreaterThanOrEqual(1);
    const served = await request(app).get(m.url);
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-type"]).toMatch(/image\/webp/);
  });
  it("rejects an HTML page renamed to .png (checked in the request)", async () => {
    expect((await up(alice, Buffer.from("<html><script>alert(document.cookie)</script></html>"), "cat.png", "image/png")).status).toBe(415);
  });
  it("rejects an SVG (can carry scripts)", async () => {
    expect((await up(alice, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "x.svg", "image/svg+xml")).status).toBe(415);
  });
  it("rejects a Windows program renamed to .png", async () => {
    expect((await up(alice, Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0x90)]), "photo.png", "image/png")).status).toBe(415);
  });
  it("garbage that only starts like a JPEG passes the quick check but fails processing (no retries)", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("this is not really an image".repeat(20))]);
    const r = await up(alice, fake, "a.jpg", "image/jpeg");
    expect(r.status).toBe(202);
    const m = await waitFor(async () => { const x = await alice.get(`/api/media/${r.body.media.id}`); return x.body.media.status === "failed" ? x.body.media : null; });
    expect(m.error).toMatch(/couldn't be read/);
  });
  it("strips a script hidden after a real image (polyglot)", async () => {
    const m = await alice.upload(Buffer.concat([await pngBuffer(), Buffer.from("<script>alert('pwned')</script>")]), "p.png");
    const served = await request(app).get(m.url).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect((served.body as Buffer).includes(Buffer.from("pwned"))).toBe(false);
  });
  it("turns a real video into adaptive HLS with a poster", async () => {
    const out = "/tmp/glimpse-test-clip.webm";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=15", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2", "-c:v", "libvpx", "-c:a", "libvorbis", out]);
    const m = await alice.upload(fs.readFileSync(out), "clip.webm");
    expect(m.status, m.error).toBe("ready");
    expect(m.kind).toBe("video");
    expect(m.hls).toMatch(/master\.m3u8$/);
    const master = await request(app).get(m.hls);
    expect(master.headers["content-type"]).toMatch(/mpegurl/);
    expect(master.text).toMatch(/#EXT-X-STREAM-INF/);
    expect(master.text.match(/#EXT-X-STREAM-INF/g)!.length).toBe(1); // 360p source: no upscaled 720p rendition
    expect(m.posterUrl).toMatch(/poster\.webp$/);
  });
  it("won't serve originals or files outside the media folder", async () => {
    expect([400, 403, 404]).toContain((await request(app).get("/media/..%2f..%2fetc%2fpasswd")).status);
    expect([403, 404]).toContain((await request(app).get("/media/.originals/anything")).status);
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
