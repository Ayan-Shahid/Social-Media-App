// CSRF protection, two layers, for every request that changes something:
//  1. The Origin (or Referer) header must be this site. Browsers set it and pages can't fake it.
//  2. Double-submit token: the X-CSRF-Token header must match the CSRF cookie. Another site can't
//     read our cookie, so it can't send the matching header.
// Session cookies are also SameSite=Lax, so most cross-site requests don't carry them at all.
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { safeEqual } from "../lib/crypto.js";
import { CSRF_COOKIE } from "./session.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const allowedOrigin = new URL(config.APP_ORIGIN).origin;

function requestOrigin(req: Request): string | null {
  const o = req.get("origin");
  if (o) return o;
  const r = req.get("referer");
  if (!r) return null;
  try { return new URL(r).origin; } catch { return null; }
}

export function csrfMiddleware(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  const origin = requestOrigin(req);
  if (origin !== allowedOrigin) return res.status(403).json({ error: "Blocked: request didn't come from this site." });
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get("x-csrf-token");
  if (!cookie || !header || !safeEqual(cookie, header)) return res.status(403).json({ error: "Blocked: missing or invalid CSRF token. Refresh the page." });
  next();
}
