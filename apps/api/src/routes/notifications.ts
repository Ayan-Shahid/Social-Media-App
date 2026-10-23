// Notifications, grouped for display: "leo and 3 others liked your post".
import { Router } from "express";
import { sql } from "drizzle-orm";
import { asUser } from "../db/client.js";
import { requireUser } from "../lib/http.js";
import { getUsers, hydrate } from "../services/hydrate.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", async (req, res) => {
  const me = requireUser(req);
  const out = await asUser(me, async (tx) => {
    // Likes and reposts are stored merged per post per day (actor_count, recent_actors). Rows from before
    // that change are one per like, so they're still grouped here the same way; everything else is one row each.
    const r = await tx.execute<{ type: string; post_id: string | null; comment_id: string | null; live_id: string | null; actors: string[]; total: number; latest: string; unread: boolean }>(sql`
      with n as (
        select *, case when type in ('like', 'repost') then coalesce(bucket::text, date_trunc('day', created_at)::date::text) else id::text end as g
        from notifications where created_at > now() - interval '30 days'
      ), groups as (
        select type, post_id, g, max(comment_id::text) as comment_id, max(live_id::text) as live_id,
          sum(actor_count)::int as total, max(created_at) as latest, bool_or(read_at is null) as unread
        from n group by type, post_id, g
      ), people as (
        select n.type, n.post_id, n.g, (array_agg(x.a order by n.created_at desc, x.o))[1:3] as actors
        from n cross join lateral unnest(n.recent_actors) with ordinality as x(a, o)
        where not app.blocked_with(x.a)
        group by n.type, n.post_id, n.g
      )
      select groups.*, people.actors from groups
      join people on people.type = groups.type and people.g = groups.g and people.post_id is not distinct from groups.post_id
      order by latest desc limit 60`);
    const users = await getUsers(tx, r.rows.flatMap((x) => x.actors));
    const postIds = [...new Set(r.rows.flatMap((x) => (x.post_id ? [x.post_id] : [])))];
    const posts = new Map((await hydrate(tx, me, postIds.map((postId) => ({ postId })))).map((p) => [p.id, p]));
    const comments = new Map((await tx.execute<{ id: string; body: string }>(sql`
      select id, body from comments where id in (select comment_id from notifications where comment_id is not null) limit 200`)).rows.map((c) => [c.id, c.body]));
    const liveIds = r.rows.flatMap((x) => (x.live_id ? [x.live_id] : []));
    const liveActive = new Set(liveIds.length ? (await tx.execute<{ id: string }>(sql`select id from live_streams where status = 'live' and id::text in (${sql.join(liveIds.map((x) => sql`${x}`), sql`, `)})`)).rows.map((x) => x.id) : []);
    return r.rows.map((n) => {
      const p = n.post_id ? posts.get(n.post_id) : undefined;
      const m = p?.media[0];
      return {
        type: n.type, total: n.total, unread: n.unread, createdAt: new Date(n.latest).toISOString(),
        actors: n.actors.map((a) => users.get(a)).filter(Boolean),
        post: p ? { id: p.id, thumbUrl: m ? m.posterUrl ?? m.url : null } : null,
        comment: n.comment_id ? comments.get(n.comment_id) ?? null : null,
        live: n.live_id ? { id: n.live_id, active: liveActive.has(n.live_id) } : null,
      };
    }).filter((n) => n.actors.length);
  });
  res.json({ notifications: out });
});

notificationsRouter.get("/unread-count", async (req, res) => {
  const me = requireUser(req);
  const r = await asUser(me, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from notifications where read_at is null`));
  res.json({ count: r.rows[0]?.n ?? 0 });
});

notificationsRouter.post("/read", async (req, res) => {
  const me = requireUser(req);
  await asUser(me, (tx) => tx.execute(sql`update notifications set read_at = now() where read_at is null`));
  res.json({ ok: true });
});
