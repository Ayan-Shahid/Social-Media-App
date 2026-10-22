"use client";
// Renders one decrypted message envelope: text, a shared post, or a story reply/reaction.
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import type { Envelope } from "@/lib/chat";
import type { Post } from "@/lib/types";
import { Avatar } from "./ui";
import { PlayIcon } from "./icons";

export function MessageBody({ env, mine, time }: { env: Envelope; mine: boolean; time: string }) {
  if (env.t === "text") {
    return <Bubble mine={mine} time={time}><span className="whitespace-pre-wrap break-words">{env.text}</span></Bubble>;
  }
  if (env.t === "post") {
    return (
      <div className={clsx("flex max-w-[75%] flex-col gap-1", mine ? "items-end" : "items-start")} title={time}>
        <SharedPost id={env.postId} />
        {env.text && <Bubble mine={mine} time={time}><span className="whitespace-pre-wrap break-words">{env.text}</span></Bubble>}
      </div>
    );
  }
  // Story reply or reaction: a small thumbnail of the story above the bubble, like Instagram.
  const label = mine ? "You replied to their story" : "Replied to your story";
  return (
    <div className={clsx("rise flex max-w-[75%] flex-col gap-1", mine ? "items-end" : "items-start")} title={time}>
      <span className="text-[12px] text-graphite">{env.t === "story_reaction" ? (mine ? "You reacted to their story" : "Reacted to your story") : label}</span>
      <StoryThumb src={env.thumb} />
      {env.t === "story_reaction"
        ? <span className="reaction-pop text-[40px] leading-none" aria-label={`Reaction ${env.emoji}`}>{env.emoji}</span>
        : <Bubble mine={mine} time={time}><span className="whitespace-pre-wrap break-words">{env.text}</span></Bubble>}
    </div>
  );
}

function Bubble({ mine, time, children }: { mine: boolean; time: string; children: React.ReactNode }) {
  return <div className={clsx("rise max-w-full rounded-2xl px-3.5 py-2 text-[15px] leading-snug", mine ? "bubble-mine" : "bubble-theirs")} title={time}>{children}</div>;
}

function StoryThumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(!src);
  return (
    <span className="relative block h-28 w-20 overflow-hidden rounded-lg bg-fog-deep ring-1 ring-rule">
      {broken ? <span className="grid h-full place-items-center px-1 text-center text-[11px] text-graphite">Story no longer available</span>
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={src!} alt="" className="h-full w-full object-cover" onError={() => setBroken(true)} />}
    </span>
  );
}

/** Loaded through the API, so the recipient's own access applies (a private post may be "unavailable"). */
function SharedPost({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["post", id], queryFn: () => api<{ post: Post }>(`/api/posts/${id}`), retry: false, staleTime: 60_000 });
  if (q.isPending) return <div className="h-64 w-56 animate-pulse rounded-xl bg-fog-deep" />;
  if (q.isError) return <div className="w-56 rounded-xl bg-fog-deep px-4 py-6 text-center text-[13px] text-graphite ring-1 ring-rule">This post is unavailable. It may have been deleted, or the account is private.</div>;
  const p = q.data.post;
  const m = p.media[0];
  const thumb = m ? (m.kind === "video" ? m.posterUrl : m.srcset[0]?.url ?? m.url) : null;
  return (
    <Link href={`/p/${p.id}`} className="rise block w-56 overflow-hidden rounded-xl bg-paper ring-1 ring-rule transition hover:-translate-y-0.5">
      <span className="flex items-center gap-2 px-3 py-2"><Avatar user={p.author} size={24} /><span className="truncate text-[13px] font-semibold">{p.author.username}</span></span>
      <span className="relative block aspect-square bg-fog-deep">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
        {m?.kind === "video" && <PlayIcon className="absolute top-2 right-2 h-5 w-5 text-white drop-shadow" />}
      </span>
      {p.caption && <span className="line-clamp-2 block px-3 py-2 text-[13px]">{p.caption}</span>}
    </Link>
  );
}
