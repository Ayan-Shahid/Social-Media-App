// Rate limits (DECISIONS.md D20): token buckets in Redis, shared by every API instance.
//
// Each person gets a bucket of tokens per kind of action. The bucket starts full ("burst"), each
// action spends one token, and tokens drip back at a steady rate. So a quick burst (liking 15 posts
// while scrolling) is fine, but a script that keeps going runs dry. Unlike a fixed window, there's no
// "double the limit across the minute boundary".
//
// Who a bucket belongs to: the signed-in account when there is one (logging in from 50 IPs doesn't give
// 50x the allowance, and people sharing an IP don't eat each other's), otherwise the client IP.
//
// If Redis can't be reached, each rule says what happens: "open" lets the request through (a short
// Redis outage shouldn't take likes and reads down with it), "closed" refuses it (login and sign-up,
// which is what attackers aim at).
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import { limitsRedis } from "../infra/redis.js";
import { rateLimited } from "../infra/metrics.js";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** burst tokens; `per` tokens come back every `ms`. */
type Bucket = { burst: number; per: number; ms: number };
type Rule = { buckets: Bucket[]; by: "user" | "ip"; onRedisDown: "open" | "closed"; message: string };

export const RULES = {
  // Likes, unlikes, saves, reposts, comment likes.
  engage: { buckets: [{ burst: 30, per: 1, ms: 1000 }], by: "user", onRedisDown: "open", message: "You're doing that too fast." },
  comment: { buckets: [{ burst: 10, per: 20, ms: HOUR }, { burst: 200, per: 200, ms: DAY }], by: "user", onRedisDown: "open", message: "You're commenting too fast." },
  // Follow, unfollow, follow requests: the classic spam move, so there's also a daily cap.
  follow: { buckets: [{ burst: 20, per: 60, ms: HOUR }, { burst: 200, per: 200, ms: DAY }], by: "user", onRedisDown: "open", message: "You're following and unfollowing too fast." },
  // Posts, shorts, stories, going live.
  publish: { buckets: [{ burst: 10, per: 30, ms: HOUR }], by: "user", onRedisDown: "open", message: "You've posted a lot in the last hour." },
  upload: { buckets: [{ burst: 30, per: 120, ms: HOUR }], by: "user", onRedisDown: "open", message: "Upload limit reached." },
  message: { buckets: [{ burst: 30, per: 1, ms: 1000 }], by: "user", onRedisDown: "open", message: "You're sending messages too fast." },
  // Anything else that changes data (on top of the specific rule, if there is one).
  write: { buckets: [{ burst: 60, per: 2, ms: 1000 }], by: "user", onRedisDown: "open", message: "You're doing that too fast." },
  // Every other GET under /api (feeds, profiles, search...).
  read: { buckets: [{ burst: 120, per: 5, ms: 1000 }], by: "user", onRedisDown: "open", message: "Too many requests." },
  // Login: per IP here, and per account in the route (an attacker spreading guesses over many IPs).
  login: { buckets: [{ burst: 10, per: 10, ms: 15 * MIN }], by: "ip", onRedisDown: "closed", message: "Too many attempts." },
  loginAccount: { buckets: [{ burst: 10, per: 10, ms: 15 * MIN }], by: "ip", onRedisDown: "closed", message: "Too many attempts for this account." },
  register: { buckets: [{ burst: 10, per: 10, ms: HOUR }], by: "ip", onRedisDown: "closed", message: "Too many sign-ups from this network." },
  oauth: { buckets: [{ burst: 30, per: 30, ms: 15 * MIN }], by: "ip", onRedisDown: "closed", message: "Too many attempts." },
} satisfies Record<string, Rule>;
export type RuleName = keyof typeof RULES;

// Tests and load tests raise the limits (RATE_LIMIT_SCALE); a test of the limits themselves sets it back to 1.
let scale = config.RATE_LIMIT_SCALE;
export const setLimitScale = (s: number) => { scale = s; };

// All buckets of a rule are checked and spent together, atomically: either every bucket has a token
// (spend one from each) or none is touched and we return how long until the emptiest one refills.
// Time comes from Redis, so instances with slightly different clocks agree.
const SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local n = #KEYS
local tokens = {}
local wait = 0
for i = 1, n do
  local cap = tonumber(ARGV[2 * i - 1]); local rate = tonumber(ARGV[2 * i])
  local v = redis.call('HMGET', KEYS[i], 't', 'ts')
  local tk = tonumber(v[1]); local ts = tonumber(v[2])
  if tk == nil or ts == nil then tk = cap; ts = now end
  tk = math.min(cap, tk + math.max(0, now - ts) * rate)
  tokens[i] = tk
  if tk < 1 then
    local w = math.ceil((1 - tk) / rate)
    if w > wait then wait = w end
  end
end
if wait > 0 then return {0, wait} end
for i = 1, n do
  local cap = tonumber(ARGV[2 * i - 1]); local rate = tonumber(ARGV[2 * i])
  redis.call('HSET', KEYS[i], 't', tostring(tokens[i] - 1), 'ts', now)
  redis.call('PEXPIRE', KEYS[i], math.ceil(cap / rate) + 1000)
end
return {1, 0}`;

export class RateLimitedError extends Error {
  constructor(public retryAfterMs: number, message: string) { super(message); }
}
export class LimitsUnavailableError extends Error {}

/**
 * Spends one token of `name` for `who`. Throws RateLimitedError when empty, LimitsUnavailableError
 * when Redis can't be reached and the rule fails closed. Fails open silently otherwise.
 */
export async function consume(name: RuleName, who: string): Promise<void> {
  const rule: Rule = RULES[name];
  const keys = rule.buckets.map((_b, i) => `rl:${name}:${i}:${who}`);
  const args = rule.buckets.flatMap((b) => [String(b.burst * scale), String((b.per * scale) / b.ms)]);
  let r: [number, number];
  try {
    r = (await limitsRedis.eval(SCRIPT, keys.length, ...keys, ...args)) as [number, number];
  } catch (e) {
    if (rule.onRedisDown === "closed") throw new LimitsUnavailableError((e as Error).message);
    return;
  }
  if (r[0] === 1) return;
  rateLimited.inc({ rule: name });
  throw new RateLimitedError(r[1], rule.message);
}

/** A bucket key that doesn't reveal the email/identifier it's for. */
export const hashId = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex").slice(0, 32);

const clientIp = (req: Request) => req.ip ?? "unknown";

export function sendLimited(res: Response, e: RateLimitedError | LimitsUnavailableError) {
  if (e instanceof RateLimitedError) {
    const secs = Math.max(1, Math.ceil(e.retryAfterMs / 1000));
    res.setHeader("Retry-After", String(secs));
    res.status(429).json({ error: `${e.message} Try again in ${secs < 90 ? `${secs} s` : `${Math.ceil(secs / 60)} min`}.`, retryAfter: secs });
  } else {
    res.status(503).json({ error: "This is briefly unavailable. Try again in a moment." });
  }
}

/** Express middleware for one rule. */
export function limit(name: RuleName): RequestHandler {
  const rule: Rule = RULES[name];
  return (req: Request, res: Response, next: NextFunction) => {
    const who = rule.by === "user" && req.userId ? `u:${req.userId}` : `ip:${clientIp(req)}`;
    consume(name, who).then(() => next(), (e) => {
      if (e instanceof RateLimitedError || e instanceof LimitsUnavailableError) sendLimited(res, e);
      else next(e);
    });
  };
}
