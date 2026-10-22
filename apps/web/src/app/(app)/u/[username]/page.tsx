"use client";
import Link from "next/link";
import { use } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Conversation, Profile } from "@/lib/types";
import { LoadMore, useInfinitePosts } from "@/components/Feed";
import { Avatar, DateStamp, Empty, Spinner } from "@/components/ui";
import { FollowButton } from "@/components/FollowButton";

export default function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const router = useRouter();
  const profile = useQuery({ queryKey: ["profile", username], queryFn: () => api<Profile>(`/api/users/${encodeURIComponent(username)}`) });
  const posts = useInfinitePosts(["user-posts", username], `/api/users/${encodeURIComponent(username)}/posts`);
  const message = useMutation({
    mutationFn: (userId: string) => api<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: { userId } }),
    onSuccess: (r) => router.push(`/messages/${r.conversation.id}`),
  });

  if (profile.isPending) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (profile.isError) return <Empty title="No one here">This account doesn&apos;t exist.</Empty>;
  const { user, counts, isFollowing, followsMe, isMe } = profile.data;
  const all = posts.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="mx-auto max-w-[900px]">
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-10">
        <Avatar user={user} size={112} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display truncate text-[26px] leading-none">{user.username}</h1>
            {isMe ? <Link href="/settings" className="btn-line">Edit profile</Link> : (
              <>
                <FollowButton userId={user.id} username={user.username} following={isFollowing} />
                <button className="btn-line" disabled={message.isPending} onClick={() => message.mutate(user.id)}>Message</button>
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

      {posts.isPending ? <Spinner /> : all.length === 0 ? (
        <Empty title={isMe ? "Share your first photo" : "No posts yet"}>{isMe && <Link href="/new" className="font-semibold text-ink underline underline-offset-4">New post</Link>}</Empty>
      ) : (
        // A contact sheet: every frame, edge to edge, each with its date.
        <div className="bg-ink p-1.5 sm:p-3">
          <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
            {all.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} className="group relative block aspect-square overflow-hidden bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.media.kind === "video" ? p.media.posterUrl ?? "" : p.media.url} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:opacity-85" />
                <DateStamp iso={p.createdAt} className="absolute right-1.5 bottom-0.5 text-[11px] sm:text-[13px]" />
              </Link>
            ))}
          </div>
        </div>
      )}
      <LoadMore q={posts} />
    </div>
  );
}
