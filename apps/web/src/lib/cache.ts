// Keeps every cached copy of a post in sync after a like/save/repost, wherever it's shown.
import type { QueryClient } from "@tanstack/react-query";
import type { Post } from "./types";

function patch(old: unknown, id: string, p: Partial<Post>): unknown {
  if (!old || typeof old !== "object") return old;
  const o = old as { pages?: { posts: Post[] }[]; post?: Post; posts?: Post[] };
  if (o.pages) return { ...o, pages: o.pages.map((pg) => ({ ...pg, posts: pg.posts.map((x) => (x.id === id ? { ...x, ...p } : x)) })) };
  if (o.post?.id === id) return { ...o, post: { ...o.post, ...p } };
  if (Array.isArray(o.posts)) return { ...o, posts: o.posts.map((x) => (x.id === id ? { ...x, ...p } : x)) };
  return old;
}

export function patchPost(qc: QueryClient, id: string, p: Partial<Post>) {
  qc.setQueriesData({ predicate: () => true }, (old: unknown) => patch(old, id, p));
}
