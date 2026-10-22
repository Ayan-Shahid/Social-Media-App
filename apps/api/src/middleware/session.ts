// Session cookie -> user. The cookie holds a random token; the database stores only its SHA-256 hash.
import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { anonymous } from "../db/client.js";
import { sha256, randomToken } from "../lib/crypto.js";
import { config, secureCookies } from "../config.js";

export const SESSION_COOKIE = secureCookies ? "__Host-glimpse_sid" : "glimpse_sid";
export const CSRF_COOKIE = secureCookies ? "__Host-glimpse_csrf" : "glimpse_csrf";

export async function resolveSession(token: string | undefined): Promise<{ userId: string; tokenHash: string } | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = sha256(token);
  const r = await anonymous((tx) => tx.execute<{ user_id: string | null }>(sql`select auth.resolve_session(${tokenHash}) as user_id`));
  const userId = r.rows[0]?.user_id;
  return userId ? { userId, tokenHash } : null;
}

export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const s = await resolveSession(req.cookies?.[SESSION_COOKIE]);
  if (s) { req.userId = s.userId; req.sessionTokenHash = s.tokenHash; }
  next();
}

const cookieBase = { secure: secureCookies, sameSite: "lax" as const, path: "/" };

/** Creates a session and sets the session cookie (httpOnly) and a fresh CSRF cookie (readable by the page). */
export async function startSession(res: Response, userId: string, userAgent: string) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + config.SESSION_DAYS * 864e5);
  await anonymous((tx) => tx.execute(sql`select auth.create_session(${sha256(token)}, ${userId}::uuid, ${expires.toISOString()}::timestamptz, ${userAgent})`));
  res.cookie(SESSION_COOKIE, token, { ...cookieBase, httpOnly: true, expires });
  setCsrfCookie(res);
}

export function setCsrfCookie(res: Response) {
  const csrf = randomToken(24);
  res.cookie(CSRF_COOKIE, csrf, { ...cookieBase, httpOnly: false });
  return csrf;
}

export async function endSession(req: Request, res: Response) {
  if (req.sessionTokenHash) await anonymous((tx) => tx.execute(sql`select auth.delete_session(${req.sessionTokenHash!})`));
  res.clearCookie(SESSION_COOKIE, cookieBase);
}
