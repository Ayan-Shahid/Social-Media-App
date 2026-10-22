"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { LoadMore, useInfinitePosts } from "@/components/Feed";
import { DateStamp, Empty, PageTitle, Spinner, UserLink } from "@/components/ui";

export default function ExplorePage() {
  const [q, setQ] = useState("");
  const term = useDeferredValue(q.trim());
  const search = useQuery({
    queryKey: ["search", term], enabled: term.length > 0,
    queryFn: () => api<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(term)}`).then((r) => r.users),
  });
  const posts = useInfinitePosts(["explore"], "/api/posts/explore");
  const all = posts.data?.pages.flatMap((p) => p.posts) ?? [];

  return (
    <div className="mx-auto max-w-[900px]">
      <PageTitle>Explore</PageTitle>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className="field mb-6 max-w-md" maxLength={30} />
      {term ? (
        <ul className="max-w-md space-y-4">
          {search.isPending && <Spinner />}
          {search.data?.map((u) => <li key={u.id}><UserLink user={u} sub={u.displayName} /></li>)}
          {search.data?.length === 0 && <li className="text-graphite">No one called &ldquo;{term}&rdquo;.</li>}
        </ul>
      ) : posts.isPending ? <Spinner /> : all.length === 0 ? (
        <Empty title="Nothing here yet">Be the first: <Link href="/new" className="font-semibold text-ink underline underline-offset-4">share a photo</Link>.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
            {all.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} className="group relative block aspect-square overflow-hidden bg-fog-deep">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.media.kind === "video" ? p.media.posterUrl ?? "" : p.media.url} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                {p.media.kind === "video" && <span className="absolute top-2 right-2 rounded bg-black/60 px-1.5 text-[11px] font-semibold text-white">VIDEO</span>}
                <DateStamp iso={p.createdAt} className="absolute right-2 bottom-1 text-[12px] opacity-0 transition group-hover:opacity-100" />
              </Link>
            ))}
          </div>
          <LoadMore q={posts} />
        </>
      )}
    </div>
  );
}
