"use client";
import { ErrorState } from "@/components/ErrorState";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { LoadMore, useInfinitePosts } from "@/components/Feed";
import { PostGrid } from "@/components/Grid";
import { Empty, PageTitle, Spinner, UserLink } from "@/components/ui";

export default function ExplorePage() {
  const [q, setQ] = useState("");
  const term = useDeferredValue(q.trim());
  const search = useQuery({ queryKey: ["search", term], enabled: term.length > 0, queryFn: () => api<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(term)}`).then((r) => r.users) });
  const trending = useQuery({ queryKey: ["trending"], queryFn: () => api<{ tags: { tag: string }[] }>("/api/tags/trending").then((r) => r.tags) });
  const posts = useInfinitePosts(["explore"], "/api/posts/explore");
  const all = posts.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="mx-auto max-w-[920px]">
      <PageTitle>Explore</PageTitle>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className="field mb-4 max-w-md" maxLength={30} />
      {!term && !!trending.data?.length && (
        <div className="mb-6 flex flex-wrap gap-2">{trending.data.map((t) => <Link key={t.tag} href={`/tags/${encodeURIComponent(t.tag)}`} className="chip">#{t.tag}</Link>)}</div>
      )}
      {term ? (
        <ul data-surface className="max-w-md space-y-4 rounded-2xl p-4">
          {search.isPending && <Spinner />}
          {search.isError && <li><ErrorState compact error={search.error} onRetry={() => search.refetch()} retrying={search.isFetching} /></li>}
          {search.data?.map((u) => <li key={u.id}><UserLink user={u} sub={u.displayName} /></li>)}
          {search.data?.length === 0 && <li className="text-graphite">No one called &ldquo;{term}&rdquo;.</li>}
        </ul>
      ) : posts.isPending ? <Spinner /> : posts.isError && !all.length ? (
        <ErrorState error={posts.error} onRetry={() => posts.refetch()} retrying={posts.isFetching} />
      ) : all.length === 0 ? (
        <Empty title="Nothing here yet">Be the first: <Link href="/new" className="font-semibold text-ink underline underline-offset-4">share a photo</Link>.</Empty>
      ) : (<><PostGrid posts={all} /><LoadMore q={posts} /></>)}
    </div>
  );
}
