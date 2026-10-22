"use client";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/dates";
import type { Post } from "@/lib/types";
import { DateStamp, UserLink } from "./ui";
import { CommentIcon, HeartIcon } from "./icons";

export function MediaView({ post, priority }: { post: Pick<Post, "media" | "createdAt" | "caption">; priority?: boolean }) {
  const m = post.media;
  const ratio = Math.min(Math.max(m.width / m.height, 0.8), 1.91); // Instagram-like crop limits
  return (
    <div className="relative overflow-hidden bg-fog-deep" style={{ aspectRatio: ratio }}>
      {m.kind === "video" ? (
        <video src={m.url} poster={m.posterUrl ?? undefined} controls playsInline preload="metadata" className="h-full w-full object-cover" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.url} alt={post.caption ? `Photo: ${post.caption.slice(0, 80)}` : "Photo"} loading={priority ? "eager" : "lazy"} className="h-full w-full object-cover" />
      )}
      <DateStamp iso={post.createdAt} className="absolute right-3 bottom-2.5" />
    </div>
  );
}

export function useLike(post: Pick<Post, "id" | "likedByMe" | "likeCount">) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (like: boolean) => api<{ liked: boolean; likeCount: number }>(`/api/posts/${post.id}/like`, { method: like ? "PUT" : "DELETE" }),
    onSuccess: (r) => {
      // Update this post everywhere it appears in the cache.
      qc.setQueriesData({ predicate: (q) => ["feed", "explore", "user-posts", "post"].includes(String(q.queryKey[0])) }, (old: unknown) => patchPost(old, post.id, { likedByMe: r.liked, likeCount: r.likeCount }));
    },
  });
}

function patchPost(old: unknown, id: string, patch: Partial<Post>): unknown {
  if (!old || typeof old !== "object") return old;
  const o = old as { pages?: { posts: Post[] }[]; post?: Post };
  if (o.pages) return { ...o, pages: o.pages.map((p) => ({ ...p, posts: p.posts.map((x) => (x.id === id ? { ...x, ...patch } : x)) })) };
  if (o.post?.id === id) return { ...o, post: { ...o.post, ...patch } };
  return old;
}

export function LikeButton({ post, className }: { post: Pick<Post, "id" | "likedByMe" | "likeCount">; className?: string }) {
  const like = useLike(post);
  const liked = like.isPending ? like.variables : post.likedByMe;
  const count = like.isPending && like.variables !== post.likedByMe ? post.likeCount + (like.variables ? 1 : -1) : post.likeCount;
  return (
    <button type="button" onClick={() => !like.isPending && like.mutate(!post.likedByMe)} aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"} className={clsx("inline-flex items-center gap-1.5 text-[14px] font-semibold", className)}>
      <HeartIcon filled={liked} className={clsx("h-6 w-6 transition", liked ? "text-heart scale-110" : "text-ink")} />
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

export function PostCard({ post, priority }: { post: Post; priority?: boolean }) {
  return (
    <article className="print">
      <MediaView post={post} priority={priority} />
      <div className="px-1 pt-3 pb-4">
        <div className="flex items-center justify-between gap-3">
          <UserLink user={post.author} size={32} sub={timeAgo(post.createdAt)} />
          <div className="flex items-center gap-4">
            <LikeButton post={post} />
            <Link href={`/p/${post.id}`} className="inline-flex items-center gap-1.5 text-[14px] font-semibold" aria-label={`${post.commentCount} comments`}>
              <CommentIcon className="h-6 w-6" /><span className="tabular-nums">{post.commentCount}</span>
            </Link>
          </div>
        </div>
        {post.caption && (
          <p className="mt-3 text-[15px] leading-snug whitespace-pre-wrap break-words">
            <Link href={`/u/${post.author.username}`} className="mr-1.5 font-semibold">{post.author.username}</Link>
            {post.caption}
          </p>
        )}
      </div>
    </article>
  );
}
