"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { FeedList, useInfinitePosts } from "@/components/Feed";
import { Empty, UserLink } from "@/components/ui";
import { FollowButton } from "@/components/FollowButton";

export default function HomePage() {
  const q = useInfinitePosts(["feed"], "/api/posts/feed");
  const suggested = useQuery({ queryKey: ["suggested"], queryFn: () => api<{ users: User[] }>("/api/users/suggested").then((r) => r.users) });
  return (
    <div className="flex gap-12">
      <div className="mx-auto w-full max-w-[520px]">
        <FeedList q={q} empty={
          <Empty title="Your feed is empty">
            Follow people to see their photos here, or <Link href="/new" className="font-semibold text-ink underline underline-offset-4">share your first post</Link>.
          </Empty>
        } />
      </div>
      <aside className="sticky top-10 hidden h-fit w-72 shrink-0 lg:block">
        <p className="label mb-4">People to follow</p>
        <ul className="space-y-4">
          {suggested.data?.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3">
              <UserLink user={u} sub={u.displayName !== u.username ? u.displayName : undefined} />
              <FollowButton userId={u.id} username={u.username} following={false} compact />
            </li>
          ))}
          {suggested.data?.length === 0 && <li className="text-[14px] text-graphite">You follow everyone here.</li>}
        </ul>
      </aside>
    </div>
  );
}
