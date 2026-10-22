// The only data anyone can read without logging in: aggregate counts for the landing page.
// Cached for a minute in Redis (numbers only, nothing per person), so the page can't be used to
// hammer Postgres.
import { Router } from "express";
import { sql } from "drizzle-orm";
import { anonymous } from "../db/client.js";
import { cached } from "../infra/cache.js";

export const publicRouter = Router();

publicRouter.get("/stats", async (_req, res) => {
  const stats = await cached("public", "public:stats", 60, async () => {
    const r = await anonymous((tx) => tx.execute<{ people: number; posts: number; shorts: number; stories_today: number; live_now: number }>(sql`select * from app.public_stats()`));
    const x = r.rows[0]!;
    return { people: x.people, posts: x.posts, shorts: x.shorts, storiesToday: x.stories_today, liveNow: x.live_now, at: new Date().toISOString() };
  });
  res.setHeader("Cache-Control", "public, max-age=60");
  res.json(stats);
});
