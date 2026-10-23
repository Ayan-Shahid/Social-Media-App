// Stories: visible for 24 hours (the RLS policy hides expired ones; a worker deletes them later).
import { limit } from "../lib/limits.js";
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { asUser } from "../db/client.js";
import { media, stories, storyViews } from "../db/schema.js";
import { badRequest, notFound, parse, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { getUsers, mediaDto } from "../services/hydrate.js";

export const storiesRouter = Router();

/** The row of avatars at the top of the feed: you and people you follow with active stories. */
storiesRouter.get("/tray", async (req, res) => {
  const me = requireUser(req);
  const out = await asUser(me, async (tx) => {
    const r = await tx.execute<{ author_id: string; latest: string; unseen: number }>(sql`
      select s.author_id, max(s.created_at) as latest,
        count(*) filter (where not exists (select 1 from story_views v where v.story_id = s.id and v.viewer_id = ${me}))::int as unseen
      from stories s
      where (s.author_id = ${me} or s.author_id in (select followee_id from follows where follower_id = ${me}))
        and not exists (select 1 from mutes m where m.muter_id = ${me} and m.muted_id = s.author_id)
      group by s.author_id
      order by (s.author_id = ${me}) desc, (count(*) filter (where not exists (select 1 from story_views v where v.story_id = s.id and v.viewer_id = ${me})) > 0) desc, max(s.created_at) desc
      limit 50`);
    const users = await getUsers(tx, r.rows.map((x) => x.author_id));
    return r.rows.filter((x) => users.has(x.author_id)).map((x) => ({ user: users.get(x.author_id)!, latest: new Date(x.latest).toISOString(), allSeen: x.unseen === 0 }));
  });
  res.json({ tray: out });
});

storiesRouter.get("/user/:userId", async (req, res) => {
  const me = requireUser(req);
  const userId = parse(z.uuid(), req.params.userId);
  const out = await asUser(me, async (tx) => {
    const r = await tx.execute<Parameters<typeof mediaDto>[0] & { story_id: string; created_at: string; expires_at: string; seen: boolean; views: number }>(sql`
      select s.id as story_id, s.created_at, s.expires_at, m.id, m.kind, m.status, m.error, m.variants, m.file_name, m.poster_file_name, m.width, m.height, m.duration_ms,
        exists (select 1 from story_views v where v.story_id = s.id and v.viewer_id = ${me}) as seen,
        (select count(*)::int from story_views v where v.story_id = s.id) as views
      from stories s join media m on m.id = s.media_id
      where s.author_id = ${userId} and m.status = 'ready' order by s.created_at asc`);
    const user = (await getUsers(tx, [userId])).get(userId);
    return {
      user, stories: r.rows.map((s) => ({
        id: s.story_id, createdAt: new Date(s.created_at).toISOString(), expiresAt: new Date(s.expires_at).toISOString(),
        seen: s.seen, media: mediaDto(s), views: userId === me ? s.views : undefined,
      })),
    };
  });
  if (!out.user) throw notFound();
  res.json(out);
});

storiesRouter.post("/", limit("publish"), idempotent, async (req, res) => {
  const me = requireUser(req);
  const { mediaId } = parse(z.object({ mediaId: z.uuid() }), req.body);
  const story = await asUser(me, async (tx) => {
    const [m] = await tx.select().from(media).where(and(eq(media.id, mediaId), eq(media.ownerId, me)));
    if (!m) throw notFound("Upload not found.");
    if (m.purpose !== "story") throw badRequest("That upload wasn't made for a story.");
    if (m.status !== "ready") throw badRequest("Still processing your upload.");
    const [s] = await tx.insert(stories).values({ authorId: me, mediaId }).returning();
    return s!;
  });
  res.status(201).json({ story: { id: story.id, expiresAt: story.expiresAt.toISOString() } });
});

storiesRouter.post("/:id/view", limit("engage"), async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  await asUser(me, (tx) => tx.insert(storyViews).values({ storyId: id, viewerId: me }).onConflictDoNothing());
  res.json({ ok: true });
});

storiesRouter.get("/:id/viewers", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const out = await asUser(me, async (tx) => {
    // RLS already limits story_views to the author; this makes "not yours" a 404 instead of an empty list.
    const own = await tx.execute(sql`select 1 from stories where id = ${id} and author_id = ${me}`);
    if (!own.rowCount) return null;
    const r = await tx.execute<{ viewer_id: string }>(sql`select viewer_id from story_views where story_id = ${id} order by viewed_at desc limit 200`);
    const u = await getUsers(tx, r.rows.map((x) => x.viewer_id));
    return r.rows.map((x) => u.get(x.viewer_id)).filter(Boolean);
  });
  if (!out) throw notFound();
  res.json({ viewers: out });
});

storiesRouter.delete("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const d = await asUser(me, (tx) => tx.delete(stories).where(eq(stories.id, id)).returning());
  if (!d.length) throw notFound();
  res.json({ ok: true });
});

