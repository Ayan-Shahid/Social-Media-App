import { Router } from "express";
import { sql, eq } from "drizzle-orm";
import { z } from "zod";
import { hash, verify } from "@node-rs/argon2";
import rateLimit from "express-rate-limit";
import { anonymous, asUser } from "../db/client.js";
import { keyBackups, publicKeys } from "../db/schema.js";
import { badRequest, HttpError, parse, unauthorized } from "../lib/http.js";
import { endSession, setCsrfCookie, startSession } from "../middleware/session.js";
import { getPublicUser } from "./users.js";

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
});

const loginSchema = z.object({ email: z.string().trim().max(200), password: z.string().max(200) });

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many attempts. Try again in a few minutes." } });
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many sign-ups from this network. Try later." } });

/** Gives the page a CSRF cookie before its first POST (login / register). */
authRouter.get("/csrf", (_req, res) => {
  setCsrfCookie(res);
  res.json({ ok: true });
});

authRouter.post("/register", registerLimiter, async (req, res) => {
  const body = parse(registerSchema, req.body);
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

authRouter.post("/login", loginLimiter, async (req, res) => {
  const body = parse(loginSchema, req.body);
  const r = await anonymous((tx) => tx.execute<{ user_id: string; password_hash: string }>(sql`select * from auth.find_login(${body.email})`));
  const row = r.rows[0];
  const ok = await verify(row?.password_hash ?? DUMMY_HASH, body.password).catch(() => false);
  if (!row || !ok) throw new HttpError(401, "Wrong email or password.", { password: "Wrong email or password." });
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
  const user = await asUser(userId, (tx) => getPublicUser(tx, userId));
  res.json({ user });
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
  return { ciphertext: b.ciphertext, nonce: b.nonce, salt: b.salt, opsLimit: b.opsLimit, memLimit: b.memLimit };
}
