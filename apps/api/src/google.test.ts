// Sign in with Google against a local mock identity provider that signs real ID tokens (RS256),
// so every check runs for real: PKCE, state, nonce, signature, issuer, audience, single use.
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import request from "supertest";
import type { Express } from "express";
import { Client, resetAll } from "./test/harness.js";

const ISSUER = "http://localhost:4599";
let app: Express;
let idp: http.Server;
// What the mock will say about the next user who signs in.
let nextIdentity: { sub: string; email: string; email_verified: boolean; name: string } = { sub: "g-1", email: "maya@gmail.com", email_verified: true, name: "Maya" };
let tamperNonce = false;

beforeAll(async () => {
  await resetAll();
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { nonce: string; challenge: string; identity: typeof nextIdentity }>();
  const m = express();
  m.use(express.urlencoded({ extended: false }));
  m.get("/.well-known/openid-configuration", (_q, r) => r.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` }));
  m.get("/jwks", (_q, r) => r.json({ keys: [jwk] }));
  m.get("/authorize", (q, r) => {
    const code = `code-${Math.random()}`;
    codes.set(code, { nonce: String(q.query.nonce), challenge: String(q.query.code_challenge), identity: nextIdentity });
    r.redirect(`${String(q.query.redirect_uri)}?code=${code}&state=${q.query.state}`);
  });
  m.post("/token", async (q, r) => {
    const c = codes.get(q.body.code);
    codes.delete(q.body.code);
    const pkceOk = c && createHash("sha256").update(q.body.code_verifier).digest("base64url") === c.challenge;
    if (!c || !pkceOk || q.body.client_id !== "test-client-id") return r.status(400).json({ error: "invalid_grant" });
    const idToken = await new SignJWT({ ...c.identity, nonce: tamperNonce ? "wrong" : c.nonce })
      .setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(ISSUER).setAudience("test-client-id")
      .setSubject(c.identity.sub).setIssuedAt().setExpirationTime("5m").sign(privateKey);
    r.json({ id_token: idToken, access_token: "x" });
  });
  idp = m.listen(4599);
  app = (await import("./app.js")).createApp();
});

afterAll(async () => {
  idp.close();
  (await import("./infra/redis.js")).redis.disconnect();
  await (await import("./db/client.js")).pool.end();
});

/** Plays the browser: start -> Google -> back to our callback, keeping cookies. */
async function signIn(agent = request.agent(app)) {
  const start = await agent.get("/api/auth/google/start?next=/explore");
  expect(start.status).toBe(302);
  const atGoogle = await request(ISSUER).get(start.headers.location!.replace(ISSUER, ""));
  const callbackUrl = new URL(atGoogle.headers.location!);
  const cb = await agent.get(callbackUrl.pathname + callbackUrl.search);
  return { agent, cb, callbackPath: callbackUrl.pathname + callbackUrl.search };
}

describe("Sign in with Google", () => {
  it("creates an account on first sign-in, and signs into the same account next time", async () => {
    nextIdentity = { sub: "g-1", email: "maya@gmail.com", email_verified: true, name: "Maya Chen" };
    const first = await signIn();
    expect(first.cb.status).toBe(302);
    expect(first.cb.headers.location).toBe("/?welcome=google");
    const me = await first.agent.get("/api/auth/me");
    expect(me.body.user.username).toBe("maya");
    expect(me.body.chatKeys).toBeNull(); // will set a chat passcode on first visit to messages
    const second = await signIn();
    expect(second.cb.headers.location).toBe("/explore");
    expect((await second.agent.get("/api/auth/me")).body.user.id).toBe(me.body.user.id);
  });

  it("links to an existing password account only when Google has verified the email", async () => {
    const owner = await (await new Client(app).init()).register("priya"); // priya@example.com
    nextIdentity = { sub: "g-attacker", email: "priya@example.com", email_verified: false, name: "Not Priya" };
    const attacker = await signIn();
    const who = await attacker.agent.get("/api/auth/me");
    expect(who.body.user.id).not.toBe(owner.user!.id); // NOT taken over: a separate new account
    nextIdentity = { sub: "g-priya", email: "priya@example.com", email_verified: true, name: "Priya" };
    const real = await signIn();
    expect((await real.agent.get("/api/auth/me")).body.user.id).toBe(owner.user!.id);
  });

  it("rejects a callback from a different browser (state cookie mismatch)", async () => {
    nextIdentity = { sub: "g-2", email: "x@gmail.com", email_verified: true, name: "X" };
    const victim = request.agent(app);
    const start = await victim.get("/api/auth/google/start");
    const atGoogle = await request(ISSUER).get(start.headers.location!.replace(ISSUER, ""));
    const url = new URL(atGoogle.headers.location!);
    const otherBrowser = await request.agent(app).get(url.pathname + url.search);
    expect(otherBrowser.headers.location).toMatch(/^\/login\?error=/);
  });

  it("a replayed callback fails (state is single use)", async () => {
    nextIdentity = { sub: "g-3", email: "y@gmail.com", email_verified: true, name: "Y" };
    const { agent, callbackPath } = await signIn();
    const again = await agent.get(callbackPath);
    expect(again.headers.location).toMatch(/^\/login\?error=/);
  });

  it("rejects an ID token with the wrong nonce", async () => {
    nextIdentity = { sub: "g-4", email: "z@gmail.com", email_verified: true, name: "Z" };
    tamperNonce = true;
    const { cb } = await signIn();
    tamperNonce = false;
    expect(cb.headers.location).toMatch(/^\/login\?error=/);
  });

  it("Google users protect their chat key with a passcode, set once", async () => {
    nextIdentity = { sub: "g-1", email: "maya@gmail.com", email_verified: true, name: "Maya Chen" };
    const { agent } = await signIn();
    const csrfRes = await agent.get("/api/auth/csrf");
    const csrf = /glimpse_csrf=([^;]+)/.exec(String(csrfRes.headers["set-cookie"]))![1]!;
    const body = { publicKey: "A".repeat(44), backup: { ciphertext: "B".repeat(80), nonce: "C".repeat(32), salt: "D".repeat(24), opsLimit: 2, memLimit: 67108864 } };
    const ok = await agent.post("/api/keys/setup").set("Origin", "http://localhost:3000").set("X-CSRF-Token", csrf).send(body);
    expect(ok.status).toBe(201);
    expect((await agent.get("/api/auth/me")).body.chatKeys).toBe("passcode");
    const again = await agent.post("/api/keys/setup").set("Origin", "http://localhost:3000").set("X-CSRF-Token", csrf).send(body);
    expect(again.status).toBe(409);
  });
});
