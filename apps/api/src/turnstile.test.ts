// Cloudflare Turnstile on sign-up (always) and login (after 3 failures). Cloudflare's siteverify is
// replaced by a local stand-in: token "good-<action>" passes for that action, anything else fails.
import { vi, beforeAll, afterAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { Express } from "express";

vi.hoisted(() => {
  process.env.TURNSTILE_SITE_KEY = "0x-test-site-key";
  process.env.TURNSTILE_SECRET_KEY = "0x-test-secret";
  process.env.TURNSTILE_VERIFY_URL = "http://localhost:4598/siteverify";
});

import { Client, resetAll } from "./test/harness.js";

let app: Express;
let server: http.Server;
const seen: { secret: string; response: string; remoteip?: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => {
      const body = JSON.parse(b);
      seen.push(body);
      const m = /^good-(\w+)$/.exec(body.response);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(m && body.secret === "0x-test-secret"
        ? { success: true, action: m[1], hostname: "localhost" }
        : { success: false, "error-codes": ["invalid-input-response"] }));
    });
  }).listen(4598);
  await resetAll();
  app = (await import("./app.js")).createApp();
});

afterAll(async () => {
  server.close();
  (await import("./infra/redis.js")).redis.disconnect();
  (await import("./infra/redis.js")).limitsRedis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

/** Registers with a given captcha token (null = none). */
async function register(c: Client, username: string, captchaToken: string | null) {
  const _s = (await import("libsodium-wrappers-sumo")).default; await _s.ready;
  const b64 = (x: Uint8Array) => _s.to_base64(x, _s.base64_variants.ORIGINAL);
  const kp = _s.crypto_box_keypair();
  return c.send("post", "/api/auth/register", {
    username, email: `${username}@example.com`, password: "correct horse battery",
    keys: { publicKey: b64(kp.publicKey), backup: { ciphertext: b64(new Uint8Array(72)), nonce: b64(new Uint8Array(24)), salt: b64(new Uint8Array(16)), opsLimit: 2, memLimit: 16 * 1024 * 1024 } },
    ...(captchaToken !== null && { captchaToken }),
  });
}

describe("Turnstile", () => {
  it("the sign-in pages are told the public site key (never the secret)", async () => {
    const c = await new Client(app).init();
    const r = await c.get("/api/auth/providers");
    expect(r.body.turnstile).toBe("0x-test-site-key");
    expect(JSON.stringify(r.body)).not.toContain("secret");
  });

  it("sign-up needs a valid token made for sign-up", async () => {
    const c = await new Client(app).init();
    const none = await register(c, "nobot", null);
    expect(none.status).toBe(403);
    expect(none.body.captchaRequired).toBe(true);
    expect((await register(c, "nobot", "forged")).status).toBe(403);
    expect((await register(c, "nobot", "good-login")).status).toBe(403); // a login token can't be reused here
    expect((await register(c, "human", "good-register")).status).toBe(201);
    expect(seen.at(-1)).toMatchObject({ secret: "0x-test-secret", response: "good-register", remoteip: c.ip });
  });

  it("login: no check at first; after 3 failures it's required, and a valid one lets the right password in", async () => {
    const c = await new Client(app).init();
    const login = (password: string, captchaToken?: string) => c.send("post", "/api/auth/login", { email: "human@example.com", password, ...(captchaToken && { captchaToken }) });
    const calls = seen.length;
    for (let i = 0; i < 3; i++) expect((await login("wrong-password")).status).toBe(401);
    expect(seen.length).toBe(calls); // Cloudflare not even asked yet
    const blocked = await login("correct horse battery");
    expect(blocked.status).toBe(403);
    expect(blocked.body.captchaRequired).toBe(true);
    expect((await login("correct horse battery", "good-login")).status).toBe(200);
  });
});
