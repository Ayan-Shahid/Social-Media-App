"use client";
import { ErrorState } from "@/components/ErrorState";
import { use } from "react";
import { LoadMore, useInfinitePosts } from "@/components/Feed";
import { PostGrid } from "@/components/Grid";
import { Empty, PageTitle, Spinner } from "@/components/ui";

export default function TagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = use(params);
  const t = decodeURIComponent(tag);
  const q = useInfinitePosts(["tag", t], `/api/tags/${encodeURIComponent(t)}`);
  const all = q.data?.pages.flatMap((p) => p.posts) ?? [];
  const count = (q.data?.pages[0] as unknown as { count?: number } | undefined)?.count ?? 0;
  return (
    <div className="mx-auto max-w-[920px]">
      <PageTitle>#{t}</PageTitle>
      <p className="-mt-3 mb-6 text-[14px] text-graphite">{count} post{count === 1 ? "" : "s"}</p>
      {q.isPending ? <Spinner /> : q.isError && !all.length ? <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} /> : all.length ? <><PostGrid posts={all} /><LoadMore q={q} /></> : <Empty title="No posts with this tag" />}
    </div>
  );
}
