// Cache-aside with stampede protection (DECISIONS.md D4).
//
//   read:  cache -> (miss) -> one loader per key -> database -> cache
//   write: database -> delete cache key
//
// IMPORTANT: shared cache entries sit OUTSIDE row-level security. Only cache data that every
// signed-in user is allowed to see. Per-viewer facts (likedByMe, isFollowing, ...) are never put
// in shared entries. If private accounts are added, post/profile entries must stop being shared.
import { redis, keys } from "./redis.js";
import { cacheHits, cacheMisses, dbLoads } from "./metrics.js";

const NOT_FOUND = "__nf__";
const NEGATIVE_TTL = 30;
const inflight = new Map<string, Promise<unknown>>(); // same-process single-flight

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Returns the cached value or loads it once. Across processes, a short Redis lock makes sure only
 * one instance hits the database for a cold key; the others wait briefly for the fresh value.
 */
export async function cached<T>(name: string, key: string, ttlSeconds: number, load: () => Promise<T | null>): Promise<T | null> {
  const hit = await redis.get(key);
  if (hit !== null) {
    cacheHits.inc({ cache: name });
    return hit === NOT_FOUND ? null : (JSON.parse(hit) as T);
  }
  cacheMisses.inc({ cache: name });

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T | null>;

  const p = (async () => {
    const lockKey = keys.lock(key);
    const gotLock = await redis.set(lockKey, "1", "PX", 3000, "NX");
    if (!gotLock) {
      // Another instance is loading it. Wait for its result (up to ~1.5 s), then fall back to loading ourselves.
      for (let i = 0; i < 15; i++) {
        await sleep(100);
        const v = await redis.get(key);
        if (v !== null) return v === NOT_FOUND ? null : (JSON.parse(v) as T);
      }
    }
    try {
      dbLoads.inc({ cache: name });
      const value = await load();
      if (value === null) await redis.set(key, NOT_FOUND, "EX", NEGATIVE_TTL);
      else await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
      return value;
    } finally {
      if (gotLock) await redis.del(lockKey);
    }
  })().finally(() => inflight.delete(key));

  inflight.set(key, p);
  return p as Promise<T | null>;
}

/**
 * Batch version for lists (feeds): one MGET, then one database query for all misses.
 * Uses the same keys as `cached`, so single and batch reads share entries.
 */
export async function cachedMany<T>(name: string, ids: string[], keyOf: (id: string) => string, ttlSeconds: number,
  loadMany: (ids: string[]) => Promise<Map<string, T>>): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (!ids.length) return out;
  const raw = await redis.mget(ids.map(keyOf));
  const missing: string[] = [];
  raw.forEach((v, i) => {
    const id = ids[i]!;
    if (v === null) missing.push(id);
    else if (v !== NOT_FOUND) out.set(id, JSON.parse(v) as T);
  });
  cacheHits.inc({ cache: name }, ids.length - missing.length);
  if (missing.length) {
    cacheMisses.inc({ cache: name }, missing.length);
    dbLoads.inc({ cache: name });
    const loaded = await loadMany(missing);
    const pipe = redis.pipeline();
    for (const id of missing) {
      const v = loaded.get(id);
      if (v === undefined) pipe.set(keyOf(id), NOT_FOUND, "EX", NEGATIVE_TTL);
      else { out.set(id, v); pipe.set(keyOf(id), JSON.stringify(v), "EX", ttlSeconds); }
    }
    await pipe.exec();
  }
  return out;
}

export const invalidate = (...ks: string[]) => (ks.length ? redis.del(...ks) : Promise.resolve(0));
