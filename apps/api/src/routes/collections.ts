// Saved posts and collections. Private: RLS only lets the owner see them.
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { asUser } from "../db/client.js";
import { collections } from "../db/schema.js";
import { badRequest, notFound, parse, requireUser } from "../lib/http.js";
import { hydrate } from "../services/hydrate.js";

export const collectionsRouter = Router();

collectionsRouter.get("/", async (req, res) => {
  const me = requireUser(req);
  const out = await asUser(me, async (tx) => {
    const r = await tx.execute<{ id: string; name: string; count: number; cover: string | null }>(sql`
      select c.id, c.name, count(s.post_id)::int as count,
        (select s2.post_id from saved_posts s2 where s2.collection_id = c.id order by s2.created_at desc limit 1) as cover
      from collections c left join saved_posts s on s.collection_id = c.id
      group by c.id order by c.created_at`);
    const all = await tx.execute<{ count: number; cover: string | null }>(sql`
      select count(*)::int as count, (select post_id from saved_posts order by created_at desc limit 1) as cover from saved_posts`);
    const coverIds = [...r.rows.map((x) => x.cover), all.rows[0]?.cover].filter((x): x is string => !!x);
    const covers = new Map((await hydrate(tx, me, coverIds.map((postId) => ({ postId })))).map((p) => [p.id, p]));
    const coverOf = (id: string | null | undefined) => {
      const m = id ? covers.get(id)?.media[0] : undefined;
      return m ? m.posterUrl ?? m.url : null;
    };
    return {
      all: { count: all.rows[0]?.count ?? 0, coverUrl: coverOf(all.rows[0]?.cover) },
      collections: r.rows.map((c) => ({ id: c.id, name: c.name, count: c.count, coverUrl: coverOf(c.cover) })),
    };
  });
  res.json(out);
});

collectionsRouter.post("/", async (req, res) => {
  const me = requireUser(req);
  const { name } = parse(z.object({ name: z.string().trim().min(1, "Name it").max(60) }), req.body);
  try {
    const [c] = await asUser(me, (tx) => tx.insert(collections).values({ ownerId: me, name }).returning());
    res.status(201).json({ collection: { id: c!.id, name: c!.name, count: 0, coverUrl: null } });
  } catch (e) {
    if ((e as { cause?: { constraint?: string } }).cause?.constraint === "collections_owner_name_key") throw badRequest("You already have a collection with that name.", { name: "Already exists." });
    throw e;
  }
});

collectionsRouter.delete("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const d = await asUser(me, (tx) => tx.delete(collections).where(and(eq(collections.id, id), eq(collections.ownerId, me))).returning());
  if (!d.length) throw notFound();
  res.json({ ok: true });
});

/** Saved posts, optionally in one collection. */
collectionsRouter.get("/saved", async (req, res) => {
  const me = requireUser(req);
  const cid = req.query.collection ? parse(z.uuid(), req.query.collection) : null;
  const posts = await asUser(me, async (tx) => {
    const r = await tx.execute<{ post_id: string }>(sql`
      select post_id from saved_posts ${cid ? sql`where collection_id = ${cid}` : sql``} order by created_at desc limit 120`);
    return hydrate(tx, me, r.rows.map((x) => ({ postId: x.post_id })));
  });
  res.json({ posts });
});
