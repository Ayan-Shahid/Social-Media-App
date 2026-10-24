"use client";
// Full-height vertical player. Each short plays when it's mostly on screen and pauses when it leaves.
import { ErrorState } from "@/components/ErrorState";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useInfinitePosts, LoadMore } from "@/components/Feed";
import { Video } from "@/components/Media";
import { LikeButton, RepostButton, SaveButton, ShareButton } from "@/components/PostCard";
import { RichText } from "@/components/RichText";
import { Avatar, Empty, Spinner } from "@/components/ui";
import { CommentIcon, SoundIcon } from "@/components/icons";
import type { Post } from "@/lib/types";

function Short({ post, muted, onToggleSound }: { post: Post; muted: boolean; onToggleSound: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      const v = video.current;
      if (!v) return;
      if (e!.intersectionRatio > 0.7) v.play().catch(() => {}); else v.pause();
    }, { threshold: [0, 0.7, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (video.current) video.current.muted = muted; }, [muted]);
  const m = post.media[0]!;
  return (
    <div ref={box} className="relative mx-auto h-[calc(100dvh-8rem)] max-h-[860px] snap-start snap-always overflow-hidden rounded-2xl bg-black md:h-[calc(100dvh-5rem)]" style={{ aspectRatio: "9 / 16" }}>
      <Video m={m} className="h-full w-full" loop muted={muted} controls={false} onRef={(v) => (video.current = v)} />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-4 pt-16 pb-5 pr-20 text-white">
        <Link href={`/u/${post.author.username}`} className="flex items-center gap-2 font-semibold"><Avatar user={post.author} size={30} />{post.author.username}</Link>
        {post.caption && <p className="mt-2 text-[14px] leading-snug [&_a]:text-orange-200"><RichText text={post.caption} /></p>}
      </div>
      <div className="absolute right-3 bottom-6 flex flex-col items-center gap-5">
        <LikeButton post={post} big />
        <Link href={`/p/${post.id}`} className="flex flex-col items-center text-[12px] font-semibold text-white"><CommentIcon className="h-8 w-8" />{post.commentCount}</Link>
        <RepostButton post={post} big />
        <ShareButton post={post} className="text-white drop-shadow" />
        <SaveButton post={post} big />
        <button onClick={onToggleSound} aria-label={muted ? "Unmute" : "Mute"} className="text-white"><SoundIcon filled={!muted} className="h-7 w-7" /></button>
      </div>
    </div>
  );
}

export default function ShortsPage() {
  const q = useInfinitePosts(["shorts"], "/api/posts/shorts");
  const [muted, setMuted] = useState(true); // browsers only autoplay muted video
  if (q.isPending) return <div className="flex justify-center py-20"><Spinner /></div>;
  const posts = q.data?.pages.flatMap((p) => p.posts) ?? [];
  if (q.isError && !posts.length) return <div className="mx-auto max-w-md"><ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} /></div>;
  if (!posts.length) return <div className="mx-auto max-w-md"><Empty title="No shorts yet">Post a vertical video up to 60 seconds from <Link href="/new?kind=short" className="font-semibold text-ink underline underline-offset-4">New post</Link>.</Empty></div>;
  return (
    <div className="-my-6 h-[calc(100dvh-8rem)] snap-y snap-mandatory space-y-6 overflow-y-auto py-2 md:-my-10 md:h-dvh md:py-10 [scrollbar-width:none]">
      {posts.map((p) => <Short key={p.id} post={p} muted={muted} onToggleSound={() => setMuted((m) => !m)} />)}
      <LoadMore q={q} />
    </div>
  );
}
