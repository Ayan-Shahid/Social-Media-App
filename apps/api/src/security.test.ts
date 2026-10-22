// End-to-end API tests against a real Postgres database. Each block tries to break one protection.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import pg from "pg";
import sharp from "sharp";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import _sodium from "libsodium-wrappers-sumo";
import { runMigrations } from "./db/migrate.js";

const ORIGIN = "http://localhost:3000";
let app: import("express").Express;
let sodium: typeof _sodium;

async function resetDb() {
  const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  await owner.query("drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists drizzle cascade; create schema public;");
  await owner.end();
  await runMigrations(process.env.MIGRATION_DATABASE_URL!, "glimpse_app", "testpass");
}

/** A browser-like client: keeps cookies, sends Origin + CSRF header like the real frontend. */
class Client {
  agent = request.agent(app);
  csrf = "";
  keys = sodium.crypto_box_keypair();
  user: { id: string; username: string } | null = null;
  async init() {
    const r = await this.agent.get("/api/auth/csrf");
    this.csrf = /glimpse_csrf=([^;]+)/.exec(String(r.headers["set-cookie"]))![1]!;
    return this;
  }
  grabCsrf(r: request.Response) {
    const m = /glimpse_csrf=([^;]+)/.exec(String(r.headers["set-cookie"] ?? ""));
    if (m) this.csrf = m[1]!;
    return r;
  }
  get(url: string) { return this.agent.get(url); }
  send(method: "post" | "put" | "patch" | "delete", url: string, body?: object, headers: Record<string, string> = {}) {
    let r = this.agent[method](url).set("Origin", ORIGIN).set("X-CSRF-Token", this.csrf);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return body ? r.send(body) : r;
  }
  async register(username: string) {
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const key = sodium.crypto_pwhash(32, "correct horse battery", salt, 2, 16 * 1024 * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
    const b = (x: Uint8Array) => sodium.to_base64(x, sodium.base64_variants.ORIGINAL);
    const r = this.grabCsrf(await this.send("post", "/api/auth/register", {
      username, email: `${username}@example.com`, password: "correct horse battery",
      keys: { publicKey: b(this.keys.publicKey), backup: { ciphertext: b(sodium.crypto_secretbox_easy(this.keys.privateKey, nonce, key)), nonce: b(nonce), salt: b(salt), opsLimit: 2, memLimit: 16 * 1024 * 1024 } },
    }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    this.user = r.body.user;
    return this;
  }
}

const key = () => `k_${Math.random().toString(36).slice(2)}${Date.now()}`;
const pngBuffer = () => sharp({ create: { width: 64, height: 48, channels: 3, background: "#3366cc" } }).png().toBuffer();

let alice: Client, bob: Client, carol: Client;

beforeAll(async () => {
  fs.rmSync("/tmp/glimpse-test-media", { recursive: true, force: true });
  await resetDb();
  sodium = (await _sodium.ready, _sodium);
  app = (await import("./app.js")).createApp();
  alice = await (await new Client().init()).register("alice");
  bob = await (await new Client().init()).register("bob");
  carol = await (await new Client().init()).register("carol");
});

afterAll(async () => { (await import("./db/client.js")).pool.end(); });

describe("auth", () => {
  it("logs in, never returns the password hash, rejects wrong passwords the same way for unknown emails", async () => {
    const c = await new Client().init();
    const ok = c.grabCsrf(await c.send("post", "/api/auth/login", { email: "alice@example.com", password: "correct horse battery" }));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toMatch(/argon2|password/i);
    expect(ok.body.keyBackup.ciphertext).toBeTruthy();
    const bad = await c.send("post", "/api/auth/login", { email: "alice@example.com", password: "nope-nope" });
    const unknown = await c.send("post", "/api/auth/login", { email: "nobody@example.com", password: "nope-nope" });
    expect(bad.status).toBe(401);
    expect(unknown.body.error).toBe(bad.body.error);
  });
  it("rejects duplicate usernames with a field error", async () => {
    const c = await new Client().init();
    const r = await c.send("post", "/api/auth/register", { username: "ALICE", email: "x@example.com", password: "12345678", keys: { publicKey: "A".repeat(44), backup: { ciphertext: "A".repeat(80), nonce: "A".repeat(32), salt: "A".repeat(24), opsLimit: 2, memLimit: 16777216 } } });
    expect(r.status).toBe(400);
    expect(r.body.fields.username).toMatch(/taken/);
  });
  it("blocks API calls without a session", async () => {
    const r = await request(app).get("/api/posts/feed");
    expect(r.status).toBe(401);
  });
});

describe("CSRF", () => {
  it("blocks a write from another website", async () => {
    const r = await alice.agent.patch("/api/users/me").set("Origin", "https://evil.example").set("X-CSRF-Token", alice.csrf).send({ bio: "hacked" });
    expect(r.status).toBe(403);
  });
  it("blocks a write without the CSRF token", async () => {
    const r = await alice.agent.patch("/api/users/me").set("Origin", ORIGIN).send({ bio: "hacked" });
    expect(r.status).toBe(403);
  });
  it("blocks a write with someone else's token", async () => {
    const r = await alice.agent.patch("/api/users/me").set("Origin", ORIGIN).set("X-CSRF-Token", bob.csrf).send({ bio: "hacked" });
    expect(r.status).toBe(403);
  });
  it("allows the real page", async () => {
    const r = await alice.send("patch", "/api/users/me", { bio: "hello" });
    expect(r.status).toBe(200);
  });
});

describe("upload sanitization", () => {
  const up = (c: Client, buf: Buffer, name: string, type: string) =>
    c.send("post", "/api/media", undefined, { "Idempotency-Key": key() }).attach("file", buf, { filename: name, contentType: type });

  it("accepts a real PNG and re-encodes it to a fresh WebP with a random name", async () => {
    const r = await up(alice, await pngBuffer(), "my photo.png", "image/png");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.media.url).toMatch(/^\/media\/[0-9a-f-]{36}\.webp$/);
    const served = await request(app).get(r.body.media.url);
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-type"]).toMatch(/image\/webp/);
  });
  it("rejects an HTML page renamed to .png", async () => {
    const r = await up(alice, Buffer.from("<html><script>alert(document.cookie)</script></html>"), "cat.png", "image/png");
    expect(r.status).toBe(415);
  });
  it("rejects an SVG (can carry scripts)", async () => {
    const r = await up(alice, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "x.svg", "image/svg+xml");
    expect(r.status).toBe(415);
  });
  it("rejects a Windows program renamed to .png", async () => {
    const exe = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(200, 0x90)]);
    const r = await up(alice, exe, "photo.png", "image/png");
    expect(r.status).toBe(415);
  });
  it("rejects garbage that only starts like a JPEG", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("this is not really an image".repeat(20))]);
    const r = await up(alice, fake, "a.jpg", "image/jpeg");
    expect(r.status).toBe(415);
  });
  it("strips a script hidden after a real image (polyglot)", async () => {
    const poly = Buffer.concat([await pngBuffer(), Buffer.from("<script>alert('pwned')</script>")]);
    const r = await up(alice, poly, "p.png", "image/png");
    expect(r.status).toBe(201);
    const served = await request(app).get(r.body.media.url).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (d: Buffer) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect((served.body as Buffer).includes(Buffer.from("pwned"))).toBe(false);
  });
  it("accepts a real video, re-encodes to MP4 and makes a poster", async () => {
    const out = "/tmp/glimpse-test-clip.webm";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15", "-t", "1", "-c:v", "libvpx", out]);
    const r = await up(alice, fs.readFileSync(out), "clip.webm", "video/webm");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.media.kind).toBe("video");
    expect(r.body.media.url).toMatch(/\.mp4$/);
    expect(r.body.media.posterUrl).toMatch(/\.webp$/);
  });
  it("won't serve files outside the media folder", async () => {
    const r = await request(app).get("/media/..%2f..%2fetc%2fpasswd");
    expect([400, 403, 404]).toContain(r.status);
  });
});

describe("idempotency", () => {
  let mediaId = "";
  beforeAll(async () => {
    const r = await alice.send("post", "/api/media", undefined, { "Idempotency-Key": key() }).attach("file", await pngBuffer(), "a.png");
    mediaId = r.body.media.id;
  });
  it("a double-submitted post creates one post and replays the same result", async () => {
    const k = key();
    const [a, b] = [await alice.send("post", "/api/posts", { mediaId, caption: "once" }, { "Idempotency-Key": k }),
                    await alice.send("post", "/api/posts", { mediaId, caption: "once" }, { "Idempotency-Key": k })];
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers["idempotent-replayed"]).toBe("true");
    expect(b.body.post.id).toBe(a.body.post.id);
    const mine = await alice.get("/api/users/alice/posts");
    expect(mine.body.posts.filter((p: { caption: string }) => p.caption === "once")).toHaveLength(1);
  });
  it("rejects reusing a key for a different request", async () => {
    const k = key();
    await alice.send("post", "/api/posts", { mediaId, caption: "first" }, { "Idempotency-Key": k });
    const r = await alice.send("post", "/api/posts", { mediaId, caption: "different" }, { "Idempotency-Key": k });
    expect(r.status).toBe(422);
  });
  it("requires a key on create actions", async () => {
    const r = await alice.send("post", "/api/posts", { mediaId, caption: "x" });
    expect(r.status).toBe(400);
  });
  it("keys are per user: bob can't replay alice's response", async () => {
    const k = key();
    const a = await alice.send("post", "/api/posts", { mediaId, caption: "mine" }, { "Idempotency-Key": k });
    const b = await bob.send("post", "/api/posts", { mediaId, caption: "mine" }, { "Idempotency-Key": k });
    expect(a.status).toBe(201);
    expect(b.status).toBe(404); // bob can't post alice's media
  });
});

describe("authorization (API level)", () => {
  it("bob can't delete alice's post", async () => {
    const feed = await alice.get("/api/users/alice/posts");
    const id = feed.body.posts[0].id;
    const r = await bob.send("delete", `/api/posts/${id}`);
    expect(r.status).toBe(404);
    expect((await alice.get(`/api/posts/${id}`)).status).toBe(200);
  });
  it("stores captions as plain text (no HTML is ever rendered from user input)", async () => {
    const m = await bob.send("post", "/api/media", undefined, { "Idempotency-Key": key() }).attach("file", await pngBuffer(), "b.png");
    const r = await bob.send("post", "/api/posts", { mediaId: m.body.media.id, caption: "<img src=x onerror=alert(1)>" }, { "Idempotency-Key": key() });
    expect(r.body.post.caption).toBe("<img src=x onerror=alert(1)>");
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.headers["content-security-policy"]).toMatch(/default-src 'none'/);
  });
});

describe("end-to-end encrypted messages", () => {
  let convId = "";
  const b64 = (x: Uint8Array) => sodium.to_base64(x, sodium.base64_variants.ORIGINAL);
  const fromB64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

  it("alice encrypts for bob; bob decrypts; the server only has ciphertext", async () => {
    const c = await alice.send("post", "/api/conversations", { userId: bob.user!.id });
    convId = c.body.conversation.id;
    const bobKey = fromB64(c.body.conversation.otherPublicKey);
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const ct = sodium.crypto_box_easy("meet at 5, the secret is pineapple", nonce, bobKey, alice.keys.privateKey);
    const sent = await alice.send("post", `/api/conversations/${convId}/messages`, { ciphertext: b64(ct), nonce: b64(nonce) }, { "Idempotency-Key": key() });
    expect(sent.status).toBe(201);

    const got = await bob.get(`/api/conversations/${convId}/messages`);
    const m = got.body.messages[0];
    const aliceKey = fromB64((await bob.get(`/api/keys/${alice.user!.id}`)).body.publicKey);
    const plain = sodium.to_string(sodium.crypto_box_open_easy(fromB64(m.ciphertext), fromB64(m.nonce), aliceKey, bob.keys.privateKey));
    expect(plain).toBe("meet at 5, the secret is pineapple");

    // Alice can read her own sent message too (same shared key).
    const own = sodium.to_string(sodium.crypto_box_open_easy(fromB64(m.ciphertext), fromB64(m.nonce), bobKey, alice.keys.privateKey));
    expect(own).toBe("meet at 5, the secret is pineapple");

    const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL }); await owner.connect();
    const dump = await owner.query("select * from messages"); await owner.end();
    expect(JSON.stringify(dump.rows)).not.toMatch(/pineapple/);
  });
  it("carol can't read or post into alice and bob's conversation", async () => {
    expect((await carol.get(`/api/conversations/${convId}`)).status).toBe(404);
    const msgs = await carol.get(`/api/conversations/${convId}/messages`);
    expect(msgs.body.messages).toHaveLength(0);
    const post = await carol.send("post", `/api/conversations/${convId}/messages`, { ciphertext: "A".repeat(40), nonce: "A".repeat(32) }, { "Idempotency-Key": key() });
    expect(post.status).toBe(404);
  });
});

describe("row-level security (database level, bypassing the API)", () => {
  // Connect straight to Postgres as the app role, like a buggy route would.
  async function as<T>(userId: string | null, q: (c: pg.Client) => Promise<T>) {
    const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    try { await c.query("begin"); if (userId) await c.query("select set_config('app.user_id', $1, true)", [userId]); return await q(c); }
    finally { await c.query("rollback").catch(() => {}); await c.end(); }
  }
  it("no user set: sees nothing", async () => {
    expect((await as(null, (c) => c.query("select * from posts"))).rowCount).toBe(0);
    expect((await as(null, (c) => c.query("select * from users"))).rowCount).toBe(0);
  });
  it("credentials and sessions are off-limits even to a signed-in user", async () => {
    await expect(as(alice.user!.id, (c) => c.query("select * from user_credentials"))).rejects.toThrow(/permission denied/);
    await expect(as(alice.user!.id, (c) => c.query("select * from sessions"))).rejects.toThrow(/permission denied/);
  });
  it("carol can't see alice and bob's messages, even with a raw SELECT", async () => {
    const r = await as(carol.user!.id, (c) => c.query("select * from messages"));
    expect(r.rowCount).toBe(0);
    const b = await as(bob.user!.id, (c) => c.query("select * from messages"));
    expect(b.rowCount).toBe(1);
  });
  it("can't post as someone else", async () => {
    const mediaId = (await as(alice.user!.id, (c) => c.query("select id from media where owner_id = $1 limit 1", [alice.user!.id]))).rows[0].id;
    await expect(as(bob.user!.id, (c) => c.query("insert into posts (author_id, media_id) values ($1, $2)", [alice.user!.id, mediaId]))).rejects.toThrow(/row-level security/);
  });
  it("can't edit someone else's profile or read their key backup", async () => {
    const r = await as(bob.user!.id, (c) => c.query("update users set bio = 'pwned' where id = $1", [alice.user!.id]));
    expect(r.rowCount).toBe(0);
    const k = await as(bob.user!.id, (c) => c.query("select * from key_backups where user_id = $1", [alice.user!.id]));
    expect(k.rowCount).toBe(0);
  });
  it("can't change columns that aren't meant to change (e.g. username via raw SQL)", async () => {
    await expect(as(alice.user!.id, (c) => c.query("update users set username = 'admin' where id = $1", [alice.user!.id]))).rejects.toThrow(/permission denied/);
  });
});
