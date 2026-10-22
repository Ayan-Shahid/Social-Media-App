// Trending hashtags with time decay, in Redis.
// Each use adds 1 to the current hour's bucket. Trending = sum of the last 24 hourly buckets,
// each weighted by 0.85^(age in hours), so a burst today beats steady use last week.
import { redis, keys } from "../infra/redis.js";

const hourNow = () => Math.floor(Date.now() / 3_600_000);

export async function countTags(tags: string[]) {
  if (!tags.length) return;
  const k = keys.tagBucket(hourNow());
  const pipe = redis.pipeline();
  for (const t of tags) pipe.zincrby(k, 1, t);
  pipe.expire(k, 25 * 3600);
  await pipe.exec();
}

export async function trendingTags(limit = 10): Promise<{ tag: string; score: number }[]> {
  const cacheKey = "tags:trending";
  const hit = await redis.get(cacheKey);
  if (hit) return JSON.parse(hit);
  const h = hourNow();
  const buckets = Array.from({ length: 24 }, (_, i) => keys.tagBucket(h - i));
  const weights = buckets.map((_, i) => (0.85 ** i).toFixed(4));
  const tmp = `tags:tmp:${process.pid}:${Date.now()}`;
  await redis.zunionstore(tmp, buckets.length, ...buckets, "WEIGHTS", ...weights);
  const raw = await redis.zrevrange(tmp, 0, limit - 1, "WITHSCORES");
  await redis.del(tmp);
  const out: { tag: string; score: number }[] = [];
  for (let i = 0; i < raw.length; i += 2) out.push({ tag: raw[i]!, score: Math.round(Number(raw[i + 1]) * 100) / 100 });
  await redis.set(cacheKey, JSON.stringify(out), "EX", 60);
  return out;
}
