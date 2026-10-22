// Two Redis instances with different jobs (DECISIONS.md D1).
//  - cache: evictable (LRU), no persistence. Cache entries, feeds, counters, presence, rate limits, realtime stream.
//  - queue: durable (AOF), never evicts. BullMQ only.
import { Redis, type RedisOptions } from "ioredis";
import { config } from "../config.js";

const base: RedisOptions = { enableAutoPipelining: true, maxRetriesPerRequest: 2, connectTimeout: 5000 };

export const redis = new Redis(config.REDIS_CACHE_URL, { ...base, connectionName: `cache:${config.INSTANCE_ID}` });

/** A separate connection for blocking reads (XREAD BLOCK), which would stall every other command on a shared one. */
export const newBlockingClient = () => new Redis(config.REDIS_CACHE_URL, { ...base, maxRetriesPerRequest: null });

/** BullMQ needs maxRetriesPerRequest: null so workers wait out Redis restarts instead of crashing. */
export const queueConnection = () => new Redis(config.REDIS_QUEUE_URL, { maxRetriesPerRequest: null, enableReadyCheck: true });

export const keys = {
  post: (id: string) => `post:${id}`,
  postStats: (id: string) => `post:${id}:stats`,
  user: (id: string) => `user:${id}`,
  userStats: (id: string) => `user:${id}:stats`,
  mutes: (id: string) => `mutes:${id}`,
  feed: (userId: string) => `feed:${userId}`,
  lock: (key: string) => `lock:${key}`,
  presence: "presence",
  realtime: "rt:events",
  tagBucket: (hour: number) => `tags:h:${hour}`,
  storyTray: (userId: string) => `stories:tray:${userId}`,
};
