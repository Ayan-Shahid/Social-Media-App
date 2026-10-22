"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import type { Conversation, Profile } from "@/lib/types";
import { LoadMore, useInfinitePosts } from "@/components/Feed";
import { PostGrid } from "@/components/Grid";
import { Button } from "@/components/Button";
import { Avatar, Empty, Spinner } from "@/components/ui";
import { FollowButton } from "@/components/FollowButton";
import { LockIcon } from "@/components/icons";

const TABS = [["posts", "Posts"], ["shorts", "Shorts"], ["reposts", "Reposts"]] as const;

export default function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("posts");
  const profile = useQuery({ queryKey: ["profile", username], queryFn: () => api<Profile>(`/api/users/${encodeURIComponent(username)}`) });
  const posts = useInfinitePosts(["user-posts", username, tab], `/api/users/${encodeURIComponent(username)}/posts?tab=${tab}`);
  const message = useMutation({
    mutationFn: (userId: string) => api<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: { userId } }),
    onSuccess: (r) => router.push(`/messages/${r.conversation.id}`),
  });

  if (profile.isPending) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (profile.isError) return <Empty title="No one here">This account doesn&apos;t exist.</Empty>;
  const { user, counts, isFollowing, followsMe, isMe, requested, isBlocked, canSeePosts } = profile.data;
  const all = posts.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="mx-auto max-w-[920px]">
      <header data-surface className="mb-8 flex flex-col gap-6 rounded-2xl p-6 sm:flex-row sm:items-center sm:gap-10">
        <Avatar user={user} size={112} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display flex items-center gap-2 truncate text-[26px] leading-none">
              {user.username}{user.isPrivate && <LockIcon className="h-5 w-5 text-graphite" aria-label="Private account" />}
            </h1>
            {isMe ? <Link href="/settings" className="btn btn-line btn-sm">Edit profile</Link> : isBlocked ? null : (
              <>
                <FollowButton key={`${isFollowing}-${requested}`} userId={user.id} username={user.username} following={isFollowing} requested={requested} isPrivate={user.isPrivate} />
                <Button variant="line" loading={message.isPending} onClick={() => message.mutate(user.id)}>Message</Button>
              </>
            )}
            {!isMe && <ProfileMenu p={profile.data} />}
            {followsMe && !isMe && <span className="text-[13px] text-graphite">Follows you</span>}
          </div>
          <dl className="flex gap-6 text-[15px]">
            {([["posts", counts.posts], ["followers", counts.followers], ["following", counts.following]] as const).map(([k, v]) => (
              <div key={k} className="flex gap-1.5"><dt className="sr-only">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd><span className="text-graphite">{k}</span></div>
            ))}
          </dl>
          {user.displayName && user.displayName !== user.username && <p className="font-semibold">{user.displayName}</p>}
          {user.bio && <p className="max-w-prose text-[15px] whitespace-pre-wrap">{user.bio}</p>}
        </div>
      </header>
      <div className="mb-5 flex gap-1 text-[14px] font-semibold" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={clsx("rounded-full px-4 py-1.5 transition", tab === k ? "bg-ink text-white" : "text-graphite hover:text-ink")}>{label}</button>
        ))}
        {isMe && <Link href="/saved" className="rounded-full px-4 py-1.5 text-graphite hover:text-ink">Saved</Link>}
      </div>
      {isBlocked ? (
        <Empty title={`You blocked ${user.username}`}>They can&apos;t see your posts or find your profile, and you won&apos;t see theirs. Unblock from the ⋯ menu.</Empty>
      ) : !canSeePosts ? (
        <div data-surface className="grid place-items-center gap-2 rounded-2xl px-6 py-14 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full ring-2 ring-ink"><LockIcon className="h-6 w-6" /></span>
          <p className="font-semibold">This account is private</p>
          <p className="max-w-xs text-[14px] text-graphite">{requested ? "Your request is waiting for approval." : `Follow ${user.username} to see their photos and videos.`}</p>
        </div>
      ) : posts.isPending ? <Spinner /> : all.length === 0 ? (
        <Empty title={isMe && tab === "posts" ? "Share your first photo" : `No ${tab} yet`}>{isMe && tab !== "reposts" && <Link href={tab === "shorts" ? "/new?kind=short" : "/new"} className="font-semibold text-ink underline underline-offset-4">Create one</Link>}</Empty>
      ) : <PostGrid posts={all} sheet={tab === "posts"} />}
      <LoadMore q={posts} />
    </div>
  );
}

/** ⋯ menu: mute, remove follower, block. Block asks first; it's the one that cuts things off. */
function ProfileMenu({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const act = useMutation({
    mutationFn: ({ path, method }: { path: string; method: "PUT" | "DELETE" }) => api(`/api/users/${p.user.id}/${path}`, { method }),
    onSuccess: () => { setOpen(false); qc.invalidateQueries({ queryKey: ["profile", p.user.username] }); qc.invalidateQueries({ queryKey: ["user-posts", p.user.username] }); qc.invalidateQueries({ queryKey: ["feed"] }); },
  });
  const items: { label: string; danger?: boolean; run: () => void }[] = [
    p.isMuted
      ? { label: "Unmute", run: () => act.mutate({ path: "mute", method: "DELETE" }) }
      : { label: "Mute posts and stories", run: () => act.mutate({ path: "mute", method: "PUT" }) },
    ...(p.followsMe ? [{ label: "Remove follower", run: () => confirm(`Remove ${p.user.username} as a follower? They won't be told.`) && act.mutate({ path: "follower", method: "DELETE" }) }] : []),
    p.isBlocked
      ? { label: "Unblock", run: () => act.mutate({ path: "block", method: "DELETE" }) }
      : { label: "Block", danger: true, run: () => confirm(`Block ${p.user.username}? They won't be able to find your profile, see your posts or message you. They won't be told.`) && act.mutate({ path: "block", method: "PUT" }) },
    { label: "Copy profile link", run: () => { navigator.clipboard?.writeText(location.href).catch(() => {}); setOpen(false); } },
  ];
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="More options" aria-expanded={open} className="grid h-9 w-9 place-items-center rounded-full text-[20px] leading-none hover:bg-white/60">⋯</button>
      {open && (
        <ul data-surface role="menu" className="rise absolute top-10 left-0 z-30 w-60 overflow-hidden rounded-xl py-1 text-[14px] shadow-lg ring-1 ring-rule">
          {items.map((it) => (
            <li key={it.label}><button role="menuitem" onClick={it.run} disabled={act.isPending} className={clsx("w-full px-4 py-2.5 text-left hover:bg-fog", it.danger && "font-semibold text-heart")}>{it.label}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}
