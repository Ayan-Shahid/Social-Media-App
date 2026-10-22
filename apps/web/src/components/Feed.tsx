"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "@/lib/api";
import type { Page, Post } from "@/lib/types";
import { PostCard } from "./PostCard";
import { Spinner } from "./ui";

export function useInfinitePosts(key: unknown[], path: string) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api<Page<Post>>(`${path}${pageParam ? `${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Loads the next page when the sentinel scrolls into view. */
export function LoadMore({ q }: { q: ReturnType<typeof useInfinitePosts> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((e) => { if (e[0]?.isIntersecting && !q.isFetchingNextPage) q.fetchNextPage(); }, { rootMargin: "800px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);
  return <div ref={ref} className="flex justify-center py-8">{q.isFetchingNextPage && <Spinner />}</div>;
}

export function FeedList({ q, empty }: { q: ReturnType<typeof useInfinitePosts>; empty: React.ReactNode }) {
  if (q.isPending) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <p className="py-10 text-center text-graphite">Couldn&apos;t load posts. Check your connection and refresh.</p>;
  const posts = q.data.pages.flatMap((p) => p.posts);
  if (!posts.length) return <>{empty}</>;
  return (
    <div className="space-y-8">
      {posts.map((p, i) => <PostCard key={`${p.id}-${p.repostedBy?.id ?? ""}`} post={p} priority={i < 2} />)}
      <LoadMore q={q} />
    </div>
  );
}
