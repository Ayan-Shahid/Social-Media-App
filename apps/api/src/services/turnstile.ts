// Cloudflare Turnstile: an "are you human" check, usually invisible (DECISIONS.md D20).
// The browser widget produces a token; we check it here with Cloudflare before trusting the request.
// Tokens are single-use and expire after 5 minutes. With no secret configured it's switched off.
import { config } from "../config.js";
import { HttpError } from "../lib/http.js";
import { limitsRedis } from "../infra/redis.js";

export const turnstileEnabled = () => !!config.TURNSTILE_SECRET_KEY && !!config.TURNSTILE_SITE_KEY;

/** Thrown when a check is needed and missing or failed; the page shows the widget and retries. */
export const captchaRequired = (message = "Please confirm you're human, then try again.") =>
  new HttpError(403, message, undefined, { captchaRequired: true });

/** Verifies a token for `action` ("login" or "register"). Refuses (fails closed) if Cloudflare can't be reached. */
export async function verifyTurnstile(token: unknown, action: string, ip: string | undefined) {
  if (!turnstileEnabled()) return;
  if (typeof token !== "string" || !token || token.length > 2048) throw captchaRequired();
  let body: { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };
  try {
    const r = await fetch(config.TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: config.TURNSTILE_SECRET_KEY, response: token, ...(ip && { remoteip: ip }) }),
      signal: AbortSignal.timeout(5000),
    });
    body = await r.json();
  } catch {
    throw new HttpError(503, "Couldn't check that you're human right now. Try again in a moment.");
  }
  // Token must be valid, made for this form, and made on this site (not lifted from another one).
  const host = new URL(config.APP_ORIGIN).hostname;
  if (!body.success || (body.action && body.action !== action) || (body.hostname && body.hostname !== host)) {
    throw captchaRequired("That check didn't go through. Please try again.");
  }
}

// Login: after 3 failed attempts from an IP or for an account (15 minutes), the check is required.
const FAIL_WINDOW = 15 * 60;
const failKeys = (ip: string, account: string) => [`authfail:ip:${ip}`, `authfail:acct:${account}`];

export async function loginNeedsCaptcha(ip: string, account: string) {
  if (!turnstileEnabled()) return false;
  try {
    const v = await limitsRedis.mget(...failKeys(ip, account));
    return v.some((x) => Number(x ?? 0) >= 3);
  } catch { return true; } // can't tell: ask (fail closed)
}

export async function recordLoginFailure(ip: string, account: string) {
  const m = limitsRedis.multi();
  for (const k of failKeys(ip, account)) m.incr(k).expire(k, FAIL_WINDOW);
  await m.exec().catch(() => {});
}

export async function clearLoginFailures(account: string) {
  await limitsRedis.del(`authfail:acct:${account}`).catch(() => {});
}
