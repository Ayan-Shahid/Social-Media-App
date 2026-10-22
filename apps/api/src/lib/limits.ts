// Rate limits stored in Redis, so they hold across every API instance (DECISIONS.md D11).
import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redis } from "../infra/redis.js";
import { config } from "../config.js";

export function limiter(name: string, windowMs: number, limit: number, message: string, byUser = false) {
  const opts: Partial<Options> = {
    windowMs, limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error: message },
    ...(byUser ? { keyGenerator: (req) => req.userId ?? ipKeyGenerator(req.ip ?? "anon") } : {}),
  };
  // Tests use the in-memory store unless they explicitly exercise Redis limits.
  if (config.NODE_ENV === "test" && !process.env.TEST_REDIS_LIMITS) return rateLimit(opts);
  return rateLimit({
    ...opts,
    store: new RedisStore({ prefix: `rl:${name}:`, sendCommand: (cmd: string, ...args: string[]) => redis.call(cmd, ...args) as never }),
  });
}
