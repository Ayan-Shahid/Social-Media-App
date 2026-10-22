"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { FeedList, useInfinitePosts } from "@/components/Feed";
import { Empty, UserLink } from "@/components/ui";
import { FollowButton } from "@/components/FollowButton";
import { StoriesTray } from "@/components/Stories";
import { useSession } from "@/lib/session";

function Welcome() {
  const welcome = useSearchParams().get("welcome");
  const { chatKeys } = useSession();
  if (welcome !== "google" || chatKeys) return null;
  return (
    <div data-surface className="rise mb-6 rounded-2xl p-4 text-[14px]">
      <p className="font-semibold">Welcome to Glimpse!</p>
      <p className="mt-1 text-graphite">Your messages are end-to-end encrypted. Because you signed in with Google, you&apos;ll set a separate chat passcode the first time you open <Link href="/messages" className="font-semibold text-ink underline underline-offset-4">Messages</Link>.</p>
    </div>
  );
}

export default function HomePage() {
  const q = useInfinitePosts(["feed"], "/api/posts/feed");
  const suggested = useQuery({ queryKey: ["suggested"], queryFn: () => api<{ users: User[] }>("/api/users/suggested").then((r) => r.users) });
  const trending = useQuery({ queryKey: ["trending"], queryFn: () => api<{ tags: { tag: string; score: number }[] }>("/api/tags/trending").then((r) => r.tags) });
  return (
    <div className="flex gap-12">
      <div className="mx-auto w-full max-w-[560px]">
        <Suspense><Welcome /></Suspense>
        <StoriesTray />
        <FeedList q={q} empty={
          <Empty title="Your feed is empty">
            Follow people to see their photos here, or <Link href="/new" className="font-semibold text-ink underline underline-offset-4">share your first post</Link>.
          </Empty>
        } />
      </div>
      <aside className="sticky top-10 hidden h-fit w-72 shrink-0 space-y-8 lg:block">
        <section data-surface className="rounded-2xl p-4">
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
        </section>
        {!!trending.data?.length && (
          <section data-surface className="rounded-2xl p-4">
            <p className="label mb-3">Trending today</p>
            <div className="flex flex-wrap gap-2">
              {trending.data.map((t) => <Link key={t.tag} href={`/tags/${encodeURIComponent(t.tag)}`} className="chip">#{t.tag}</Link>)}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
