// Shared test setup: a fresh database, empty Redis, in-process workers, and a browser-like client.
import request from "supertest";
import pg from "pg";
import fs from "node:fs";
import sharp from "sharp";
import { expect } from "vitest";
import _sodium from "libsodium-wrappers-sumo";
import type { Express } from "express";
import { runMigrations } from "../db/migrate.js";

export const ORIGIN = "http://localhost:3000";
export let sodium: typeof _sodium;

export async function resetAll() {
  const owner = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  await owner.query("drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists app cascade; drop schema if exists drizzle cascade; create schema public;");
  await owner.end();
  await runMigrations(process.env.MIGRATION_DATABASE_URL!, "glimpse_app", "testpass", "workerpass");
  const { redis } = await import("../infra/redis.js");
  await redis.flushdb();
  const { queueConnection } = await import("../infra/redis.js");
  const q = queueConnection(); await q.flushdb(); await q.quit();
  const { ensureBuckets, removePrefix, BUCKETS } = await import("../infra/storage.js");
  await ensureBuckets();
  await removePrefix(BUCKETS.uploads, ""); await removePrefix(BUCKETS.media, "");
  await _sodium.ready;
  sodium = _sodium;
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 30000, label = "condition"): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

let ipCounter = 10;
const b64 = (x: Uint8Array) => _sodium.to_base64(x, _sodium.base64_variants.ORIGINAL);

/** A browser-like client: keeps cookies, sends Origin + CSRF header like the real frontend, has its own IP. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = "";
  keys = sodium.crypto_box_keypair();
  user: { id: string; username: string } | null = null;
  /** Cookie header for non-HTTP-agent clients (WebSocket, Socket.IO). Set on register. */
  cookies = "";
  ip = `10.0.0.${ipCounter++}`;
  constructor(public app: Express) { this.agent = request.agent(app); }
  async init() { this.grabCsrf(await this.agent.get("/api/auth/csrf").set("X-Forwarded-For", this.ip)); return this; }
  grabCsrf(r: request.Response) {
    const m = /glimpse_csrf=([^;]+)/.exec(String(r.headers["set-cookie"] ?? ""));
    if (m) this.csrf = m[1]!;
    return r;
  }
  get(url: string) { return this.agent.get(url).set("X-Forwarded-For", this.ip); }
  send(method: "post" | "put" | "patch" | "delete", url: string, body?: object, headers: Record<string, string> = {}) {
    let r = this.agent[method](url).set("Origin", ORIGIN).set("X-CSRF-Token", this.csrf).set("X-Forwarded-For", this.ip);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return body ? r.send(body) : r;
  }
  async register(username: string) {
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const key = sodium.crypto_pwhash(32, "correct horse battery", salt, 2, 16 * 1024 * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
    const r = this.grabCsrf(await this.send("post", "/api/auth/register", {
      username, email: `${username}@example.com`, password: "correct horse battery",
      keys: { publicKey: b64(this.keys.publicKey), backup: { ciphertext: b64(sodium.crypto_secretbox_easy(this.keys.privateKey, nonce, key)), nonce: b64(nonce), salt: b64(salt), opsLimit: 2, memLimit: 16 * 1024 * 1024 } },
    }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    this.user = r.body.user;
    this.cookies = ([] as string[]).concat(r.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).join("; ");
    return this;
  }
  /**
   * The browser's upload flow: ask for a slot, PUT straight to storage, then "complete".
   * Returns the response that ended it: the slot request if refused there, otherwise "complete".
   * `declaredSize` lets a test lie about the size.
   */
  async startUpload(buf: Buffer, mime: string, purpose = "post", declaredSize = buf.length) {
    const slot = await this.send("post", "/api/media/uploads", { purpose, mime, size: declaredSize }, { "Idempotency-Key": key() });
    if (slot.status !== 201) return slot;
    const put = await fetch(slot.body.upload.url, { method: "PUT", body: new Uint8Array(buf), headers: slot.body.upload.headers });
    expect(put.ok, `PUT to storage: ${put.status} ${await put.clone().text()}`).toBe(true);
    return this.send("post", `/api/media/${slot.body.media.id}/complete`);
  }
  /** Uploads a file and waits for the worker to finish processing it. */
  async upload(buf: Buffer, name = "a.png", purpose = "post") {
    const r = await this.startUpload(buf, mimeOf(name), purpose);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    return waitFor(async () => {
      const m = await this.get(`/api/media/${r.body.media.id}`);
      return m.body.media.status !== "processing" ? m.body.media : null;
    }, 60000, "media processing");
  }
  async post(caption = "", mediaIds?: string[], kind = "post") {
    const ids = mediaIds ?? [(await this.upload(await pngBuffer())).id];
    const r = await this.send("post", "/api/posts", { mediaIds: ids, caption, kind }, { "Idempotency-Key": key() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.post as { id: string; caption: string };
  }
  follow(userId: string) { return this.send("put", `/api/users/${userId}/follow`); }
}

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", svg: "image/svg+xml" };
export const mimeOf = (name: string) => MIME[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
/** Fetches a public media URL the way Caddy serves it: straight from the media bucket. */
export const fetchMedia = (url: string) => fetch(`${process.env.S3_ENDPOINT}${url}`);

export const key = () => `k_${Math.random().toString(36).slice(2)}${Date.now()}`;
export const pngBuffer = (color = "#3366cc") => sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).png().toBuffer();

export async function asDb<T>(url: string, userId: string | null, q: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try { await c.query("begin"); if (userId) await c.query("select set_config('app.user_id', $1, true)", [userId]); return await q(c); }
  finally { await c.query("rollback").catch(() => {}); await c.end(); }
}
