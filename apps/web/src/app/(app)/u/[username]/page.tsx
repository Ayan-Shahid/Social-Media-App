"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import type { Conversation, Profile } from "@/lib/types";
import { LoadMore, useInfinitePosts } from "@/components/Feed";
import { PostGrid } from "@/components/Grid";
import { Button } from "@/components/Button";
import { Avatar, Empty, Spinner } from "@/components/ui";
import { FollowButton } from "@/components/FollowButton";

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
  const { user, counts, isFollowing, followsMe, isMe } = profile.data;
  const all = posts.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="mx-auto max-w-[920px]">
      <header data-surface className="mb-8 flex flex-col gap-6 rounded-2xl p-6 sm:flex-row sm:items-center sm:gap-10">
        <Avatar user={user} size={112} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display truncate text-[26px] leading-none">{user.username}</h1>
            {isMe ? <Link href="/settings" className="btn btn-line btn-sm">Edit profile</Link> : (
              <>
                <FollowButton userId={user.id} username={user.username} following={isFollowing} />
                <Button variant="line" loading={message.isPending} onClick={() => message.mutate(user.id)}>Message</Button>
              </>
            )}
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
      {posts.isPending ? <Spinner /> : all.length === 0 ? (
        <Empty title={isMe && tab === "posts" ? "Share your first photo" : `No ${tab} yet`}>{isMe && tab !== "reposts" && <Link href={tab === "shorts" ? "/new?kind=short" : "/new"} className="font-semibold text-ink underline underline-offset-4">Create one</Link>}</Empty>
      ) : <PostGrid posts={all} sheet={tab === "posts"} />}
      <LoadMore q={posts} />
    </div>
  );
}
