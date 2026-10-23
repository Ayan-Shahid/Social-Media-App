import { Router } from "express";
import { sql, eq } from "drizzle-orm";
import { z } from "zod";
import { hash, verify } from "@node-rs/argon2";
import { consume, hashId, limit, LimitsUnavailableError, RateLimitedError, sendLimited } from "../lib/limits.js";
import { clearLoginFailures, loginNeedsCaptcha, recordLoginFailure, turnstileEnabled, verifyTurnstile } from "../services/turnstile.js";
import { finishLogin, googleEnabled, startLogin, usernameFrom } from "../services/google.js";
import { config, secureCookies } from "../config.js";
import { anonymous, asUser } from "../db/client.js";
import { keyBackups, publicKeys } from "../db/schema.js";
import { badRequest, HttpError, parse, unauthorized } from "../lib/http.js";
import { endSession, setCsrfCookie, startSession } from "../middleware/session.js";
import { getPublicUser } from "./users.js";
import { isAdmin } from "./ops.js";

export const authRouter = Router();

// Argon2id with the OWASP-recommended baseline settings.
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Used to spend the same time on unknown emails, so attackers can't learn which emails exist.
const DUMMY_HASH = await hash("not-a-real-password", ARGON);

const b64 = (min: number, max: number) => z.string().regex(/^[A-Za-z0-9+/=_-]+$/, "Invalid key data").min(min).max(max);

const keysSchema = z.object({
  publicKey: b64(40, 50), // 32-byte X25519 key
  backup: z.object({
    ciphertext: b64(60, 200),
    nonce: b64(30, 40),
    salt: b64(20, 30),
    opsLimit: z.number().int().min(1).max(20),
    memLimit: z.number().int().min(8 * 1024 * 1024).max(1024 * 1024 * 1024),
  }),
});

const registerSchema = z.object({
  username: z.string().trim().regex(/^[a-zA-Z0-9_.]{3,30}$/, "3-30 letters, numbers, dots or underscores"),
  email: z.email("Enter a valid email").trim().max(200),
  password: z.string().min(8, "At least 8 characters").max(200),
  keys: keysSchema,
  captchaToken: z.string().max(2048).optional(),
});

const loginSchema = z.object({ email: z.string().trim().max(200), password: z.string().max(200), captchaToken: z.string().max(2048).optional() });

/** Gives the page a CSRF cookie before its first POST (login / register). */
authRouter.get("/csrf", (_req, res) => {
  setCsrfCookie(res);
  res.json({ ok: true });
});

authRouter.post("/register", limit("register"), async (req, res) => {
  const body = parse(registerSchema, req.body);
  await verifyTurnstile(body.captchaToken, "register", req.ip); // always, when Turnstile is on
  const passwordHash = await hash(body.password, ARGON);
  let userId: string;
  try {
    userId = await anonymous(async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`select auth.register(${body.username}, ${body.email}, ${passwordHash}) as id`);
      const id = r.rows[0]!.id;
      // Now act as the new user so RLS lets us store their keys.
      await tx.execute(sql`select set_config('app.user_id', ${id}, true)`);
      await tx.insert(publicKeys).values({ userId: id, publicKey: body.keys.publicKey });
      await tx.insert(keyBackups).values({ userId: id, ...body.keys.backup });
      return id;
    });
  } catch (e) {
    const c = (e as { cause?: { constraint?: string }; constraint?: string });
    const constraint = c.constraint ?? c.cause?.constraint;
    if (constraint === "users_username_key") throw badRequest("Please check the highlighted fields.", { username: "That username is taken." });
    if (constraint === "user_credentials_email_key") throw badRequest("Please check the highlighted fields.", { email: "An account with this email already exists." });
    throw e;
  }
  await startSession(res, userId, req.get("user-agent") ?? "");
  const user = await asUser(userId, (tx) => getPublicUser(tx, userId));
  const backup = await asUser(userId, (tx) => tx.select().from(keyBackups).where(eq(keyBackups.userId, userId)));
  res.status(201).json({ user, keyBackup: stripBackup(backup[0]) });
});

authRouter.post("/login", limit("login"), async (req, res) => {
  const body = parse(loginSchema, req.body);
  const ip = req.ip ?? "unknown";
  const account = hashId(body.email);
  // Per account as well as per IP: guesses spread over many IPs still hit this.
  try { await consume("loginAccount", account); }
  catch (e) { if (e instanceof RateLimitedError || e instanceof LimitsUnavailableError) return sendLimited(res, e); throw e; }
  // After 3 failures (this IP or this account), a human check is required.
  if (await loginNeedsCaptcha(ip, account)) await verifyTurnstile(body.captchaToken, "login", ip);
  const r = await anonymous((tx) => tx.execute<{ user_id: string; password_hash: string }>(sql`select * from auth.find_login(${body.email})`));
  const row = r.rows[0];
  const ok = await verify(row?.password_hash ?? DUMMY_HASH, body.password).catch(() => false);
  if (!row || !ok) {
    await recordLoginFailure(ip, account);
    throw new HttpError(401, "Wrong email or password.", { password: "Wrong email or password." });
  }
  await clearLoginFailures(account);
  await startSession(res, row.user_id, req.get("user-agent") ?? "");
  const user = await asUser(row.user_id, (tx) => getPublicUser(tx, row.user_id));
  const backup = await asUser(row.user_id, (tx) => tx.select().from(keyBackups).where(eq(keyBackups.userId, row.user_id)));
  res.json({ user, keyBackup: stripBackup(backup[0]) });
});

authRouter.post("/logout", async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  if (!req.userId) throw unauthorized();
  const userId = req.userId;
  const [user, backup] = await asUser(userId, async (tx) => [
    await getPublicUser(tx, userId),
    (await tx.select({ kind: keyBackups.kind }).from(keyBackups).where(eq(keyBackups.userId, userId)))[0] ?? null,
  ] as const);
  // chatKeys: how this account's message key is protected ("password", "passcode" for Google users, or null = not set up yet)
  res.json({ user, chatKeys: backup?.kind ?? null, isAdmin: await isAdmin(userId) });
});

/** The encrypted private-key backup. Only its owner can read it (RLS). Used to unlock chat on a new device. */
authRouter.get("/key-backup", async (req, res) => {
  if (!req.userId) throw unauthorized();
  const userId = req.userId;
  const backup = await asUser(userId, (tx) => tx.select().from(keyBackups).where(eq(keyBackups.userId, userId)));
  res.json({ keyBackup: stripBackup(backup[0]) });
});

function stripBackup(b: typeof keyBackups.$inferSelect | undefined) {
  if (!b) return null;
  return { ciphertext: b.ciphertext, nonce: b.nonce, salt: b.salt, opsLimit: b.opsLimit, memLimit: b.memLimit, kind: b.kind };
}

// ---------- Sign in with Google ----------

const OAUTH_COOKIE = secureCookies ? "__Host-glimpse_oauth" : "glimpse_oauth";
const safeNext = (n: unknown) => (typeof n === "string" && n.startsWith("/") && !n.startsWith("//") ? n : "/");

/** What the sign-in pages should show: the Google button, and the Turnstile widget (public site key). */
authRouter.get("/providers", (_req, res) => {
  res.json({ google: googleEnabled(), turnstile: turnstileEnabled() ? config.TURNSTILE_SITE_KEY : null });
});

authRouter.get("/google/start", limit("oauth"), async (req, res) => {
  if (!googleEnabled()) throw new HttpError(404, "Google sign-in isn't set up.");
  const { url, state } = await startLogin(safeNext(req.query.next));
  res.cookie(OAUTH_COOKIE, state, { httpOnly: true, secure: secureCookies, sameSite: "lax", path: "/", maxAge: 600_000 });
  res.redirect(302, url);
});

authRouter.get("/google/callback", async (req, res) => {
  const fail = (msg: string) => res.redirect(302, `/login?error=${encodeURIComponent(msg)}`);
  res.clearCookie(OAUTH_COOKIE, { path: "/" });
  if (typeof req.query.error === "string") return fail("Google sign-in was cancelled.");
  if (typeof req.query.code !== "string" || typeof req.query.state !== "string") return fail("Sign-in failed. Try again.");
  let id;
  try { id = await finishLogin(req.query.code, req.query.state, req.cookies?.[OAUTH_COOKIE]); }
  catch (e) { return fail(e instanceof HttpError ? e.message : "Sign-in failed. Try again."); }

  const userId = await anonymous(async (tx) => {
    const found = await tx.execute<{ id: string | null }>(sql`select auth.find_oauth('google', ${id.sub}) as id`);
    if (found.rows[0]?.id) return { id: found.rows[0].id, isNew: false };
    // Link to an existing account ONLY when Google has verified the email. Otherwise anyone could
    // create a Google account with someone else's unverified address and take over their account.
    if (id.email && id.emailVerified) {
      const byEmail = await tx.execute<{ id: string | null }>(sql`select auth.find_user_by_email(${id.email}) as id`);
      if (byEmail.rows[0]?.id) {
        await tx.execute(sql`select auth.link_oauth('google', ${id.sub}, ${byEmail.rows[0].id}::uuid, ${id.email})`);
        return { id: byEmail.rows[0].id, isNew: false };
      }
    }
    const created = await tx.execute<{ id: string }>(sql`select auth.register_oauth(${usernameFrom(id)}, ${id.name}, 'google', ${id.sub}, ${id.emailVerified ? id.email : null}) as id`);
    return { id: created.rows[0]!.id, isNew: true };
  });
  await startSession(res, userId.id, req.get("user-agent") ?? "");
  res.redirect(302, userId.isNew ? "/?welcome=google" : id.next);
});

