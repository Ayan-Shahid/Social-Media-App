"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { patchPost } from "@/lib/cache";
import { timeAgo } from "@/lib/dates";
import type { Collection, Post } from "@/lib/types";
import { DateStamp, UserLink } from "./ui";
import { BookmarkIcon, CommentIcon, HeartIcon, RepostIcon, SendIcon } from "./icons";
import { ShareSheet } from "./ShareSheet";
import { pulse } from "./ShaderBackdrop";
import { Carousel } from "./Media";
import { RichText } from "./RichText";

const ratioOf = (p: Post) => {
  const m = p.media[0];
  return m && m.width && m.height ? Math.min(Math.max(m.width / m.height, 0.8), 1.91) : 1;
};

/** Like with optimistic UI and a heart burst. */
export function LikeButton({ post, big }: { post: Post; big?: boolean }) {
  const qc = useQueryClient();
  const [burst, setBurst] = useState(0);
  const m = useMutation({
    mutationFn: (like: boolean) => api<{ likeCount: number }>(`/api/posts/${post.id}/like`, { method: like ? "PUT" : "DELETE" }),
    onMutate: (like) => { patchPost(qc, post.id, { likedByMe: like, likeCount: post.likeCount + (like ? 1 : -1) }); if (like) setBurst((b) => b + 1); },
    onSuccess: (r, like) => patchPost(qc, post.id, { likedByMe: like, likeCount: r.likeCount }),
    onError: (_e, like) => patchPost(qc, post.id, { likedByMe: !like, likeCount: post.likeCount }),
  });
  return (
    <button type="button" aria-pressed={post.likedByMe} aria-label={post.likedByMe ? "Unlike" : "Like"}
      onClick={(e) => {
        if (m.isPending) return;
        if (!post.likedByMe) { const r = e.currentTarget.getBoundingClientRect(); pulse("like", r.left + 12, r.top + 12); } // the background answers too
        m.mutate(!post.likedByMe);
      }}
      className={clsx("inline-flex items-center gap-1.5 font-semibold", big ? "flex-col text-[12px] text-white" : "text-[14px]")}>
      <span className="relative inline-grid">
        <HeartIcon key={burst} filled={post.likedByMe} className={clsx(big ? "h-8 w-8" : "h-6 w-6", post.likedByMe ? "heart-pop text-heart" : "")} />
        {burst > 0 && post.likedByMe && (
          <span key={`b${burst}`} className="burst pointer-events-none absolute inset-0" aria-hidden>
            {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ ["--a" as string]: `${i * 45}deg` }} />)}
          </span>
        )}
      </span>
      <span className="tabular-nums">{post.likeCount}</span>
    </button>
  );
}

export function RepostButton({ post, big }: { post: Post; big?: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (on: boolean) => api<{ repostCount: number }>(`/api/posts/${post.id}/repost`, { method: on ? "PUT" : "DELETE" }),
    onMutate: (on) => patchPost(qc, post.id, { repostedByMe: on, repostCount: post.repostCount + (on ? 1 : -1) }),
    onSuccess: (r, on) => patchPost(qc, post.id, { repostedByMe: on, repostCount: r.repostCount }),
    onError: (_e, on) => patchPost(qc, post.id, { repostedByMe: !on, repostCount: post.repostCount }),
  });
  return (
    <button type="button" onClick={() => !m.isPending && m.mutate(!post.repostedByMe)} aria-pressed={post.repostedByMe} aria-label={post.repostedByMe ? "Undo repost" : "Repost"}
      className={clsx("inline-flex items-center gap-1.5 font-semibold transition", big ? "flex-col text-[12px] text-white" : "text-[14px]", post.repostedByMe && !big && "text-good")}>
      <RepostIcon className={clsx(big ? "h-8 w-8" : "h-6 w-6", post.repostedByMe && "heart-pop")} />
      <span className="tabular-nums">{post.repostCount}</span>
    </button>
  );
}

/** Save (bookmark). Long-press or the small arrow opens collections. */
export function SaveButton({ post, big }: { post: Post; big?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const cols = useQuery({ queryKey: ["collections"], queryFn: () => api<{ collections: Collection[] }>("/api/collections").then((r) => r.collections), enabled: open });
  const save = useMutation({
    mutationFn: (v: { on: boolean; collectionId?: string | null }) => api(`/api/posts/${post.id}/save`, { method: v.on ? "PUT" : "DELETE", body: v.on ? { collectionId: v.collectionId ?? null } : undefined }),
    onMutate: (v) => patchPost(qc, post.id, { savedByMe: v.on }),
    onError: (_e, v) => patchPost(qc, post.id, { savedByMe: !v.on }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["collections"] }),
  });
  return (
    <span className="relative inline-flex items-center">
      <button type="button" onClick={() => save.mutate({ on: !post.savedByMe })} onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}
        aria-pressed={post.savedByMe} aria-label={post.savedByMe ? "Remove from saved" : "Save"} className={clsx(big && "text-white")}>
        <BookmarkIcon filled={post.savedByMe} className={clsx(big ? "h-8 w-8" : "h-6 w-6", post.savedByMe && "heart-pop")} />
      </button>
      {!big && <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Save to collection" className="ml-0.5 text-[11px] text-graphite">▾</button>}
      {open && (
        <div data-surface className="rise absolute right-0 bottom-9 z-20 w-56 rounded-xl border border-rule p-2 text-[14px]" onMouseLeave={() => setOpen(false)}>
          <p className="label px-2 pb-1">Save to</p>
          <button className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-fog" onClick={() => { save.mutate({ on: true }); setOpen(false); }}>All saved</button>
          {cols.data?.map((c) => (
            <button key={c.id} className="block w-full truncate rounded-lg px-2 py-1.5 text-left hover:bg-fog" onClick={() => { save.mutate({ on: true, collectionId: c.id }); setOpen(false); }}>{c.name}</button>
          ))}
          <Link href="/saved" className="block px-2 pt-1.5 text-[13px] text-graphite hover:text-ink">Manage collections</Link>
        </div>
      )}
    </span>
  );
}

/** Photos/videos with the date stamp, double-tap to like, and the "developing" effect on fresh posts. */
export function PostMedia({ post, priority }: { post: Post; priority?: boolean }) {
  const qc = useQueryClient();
  const [flash, setFlash] = useState(0);
  const lastTap = useRef(0);
  const [developing, setDeveloping] = useState(false);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(`develop:${post.id}`)) { sessionStorage.removeItem(`develop:${post.id}`); setDeveloping(true); }
    } catch { /* storage blocked */ }
  }, [post.id]);
  const like = useMutation({
    mutationFn: () => api<{ likeCount: number }>(`/api/posts/${post.id}/like`, { method: "PUT" }),
    onMutate: () => patchPost(qc, post.id, { likedByMe: true, likeCount: post.likeCount + (post.likedByMe ? 0 : 1) }),
    onSuccess: (r) => patchPost(qc, post.id, { likedByMe: true, likeCount: r.likeCount }),
  });
  const onTap = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 320) { setFlash((f) => f + 1); if (!post.likedByMe) { pulse("like", e.clientX, e.clientY); like.mutate(); } }
    lastTap.current = now;
  };
  return (
    <div className={clsx("relative overflow-hidden", developing && "developing")} onClick={onTap}>
      <Carousel media={post.media} alt={post.caption ? `Photo: ${post.caption.slice(0, 80)}` : "Photo"} ratio={ratioOf(post)} priority={priority} />
      <DateStamp iso={post.createdAt} className="absolute right-3 bottom-2.5" />
      {flash > 0 && (
        <span key={flash} className="heart-flash pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <HeartIcon filled className="h-28 w-28 text-white drop-shadow-[0_4px_18px_rgba(224,50,59,0.6)]" />
        </span>
      )}
    </div>
  );
}

export function PostCard({ post, priority }: { post: Post; priority?: boolean }) {
  return (
    <article data-surface className="print rounded-[4px] rise">
      {post.repostedBy && (
        <p className="mb-2 flex items-center gap-1.5 px-1 text-[13px] font-medium text-graphite">
          <RepostIcon className="h-4 w-4" /><Link href={`/u/${post.repostedBy.username}`} className="hover:text-ink">{post.repostedBy.username}</Link> reposted
        </p>
      )}
      <PostMedia post={post} priority={priority} />
      <div className="px-1 pt-3 pb-4">
        <div className="flex items-center justify-between gap-3">
          <UserLink user={post.author} size={32} sub={timeAgo(post.createdAt)} />
          <div className="flex items-center gap-4">
            <LikeButton post={post} />
            <Link href={`/p/${post.id}`} className="inline-flex items-center gap-1.5 text-[14px] font-semibold" aria-label={`${post.commentCount} comments`}>
              <CommentIcon className="h-6 w-6" /><span className="tabular-nums">{post.commentCount}</span>
            </Link>
            <RepostButton post={post} />
            <ShareButton post={post} />
            <SaveButton post={post} />
          </div>
        </div>
        {post.caption && (
          <p className="mt-3 text-[15px] leading-snug whitespace-pre-wrap break-words">
            <Link href={`/u/${post.author.username}`} className="mr-1.5 font-semibold">{post.author.username}</Link>
            <RichText text={post.caption} />
          </p>
        )}
      </div>
    </article>
  );
}

/** Paper plane: send the post to chats (end-to-end encrypted). */
export function ShareButton({ post, className }: { post: Post; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Share" className={clsx("transition hover:-translate-y-0.5 active:scale-90", className)}>
        <SendIcon className="h-6 w-6" />
      </button>
      {open && <ShareSheet post={post} onClose={() => setOpen(false)} />}
    </>
  );
}
