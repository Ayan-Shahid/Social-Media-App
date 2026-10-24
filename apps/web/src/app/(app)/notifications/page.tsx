"use client";
import { ErrorState } from "@/components/ErrorState";
import Link from "next/link";
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/dates";
import type { Notification, User } from "@/lib/types";
import { Button } from "@/components/Button";
import { Avatar, Empty, PageTitle, Spinner } from "@/components/ui";

const VERB: Record<Notification["type"], string> = {
  like: "liked your post", comment: "commented:", follow: "started following you", mention: "mentioned you", repost: "reposted your post",
  follow_request: "asked to follow you", follow_accept: "accepted your follow request",
  live: "started a live video",
};

/** Pending requests to a private account, answered right here. */
function FollowRequests() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["follow-requests"], queryFn: () => api<{ requests: { user: User; createdAt: string }[] }>("/api/follow-requests").then((r) => r.requests) });
  const answer = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => api(`/api/follow-requests/${id}${accept ? "/accept" : ""}`, { method: accept ? "POST" : "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["follow-requests"] }); qc.invalidateQueries({ queryKey: ["profile"] }); },
  });
  if (!q.data?.length) return null;
  return (
    <section className="mb-6">
      <h2 className="label mb-2">Follow requests · {q.data.length}</h2>
      <ul data-surface className="divide-y divide-rule overflow-hidden rounded-2xl">
        {q.data.map(({ user }) => (
          <li key={user.id} className="rise flex items-center gap-3 px-4 py-3">
            <Link href={`/u/${user.username}`}><Avatar user={user} size={40} /></Link>
            <Link href={`/u/${user.username}`} className="min-w-0 flex-1 truncate font-semibold">{user.username}</Link>
            <Button size="sm" loading={answer.isPending && answer.variables?.id === user.id && answer.variables.accept} onClick={() => answer.mutate({ id: user.id, accept: true })}>Confirm</Button>
            <Button size="sm" variant="line" onClick={() => answer.mutate({ id: user.id, accept: false })}>Delete</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ notifications: Notification[] }>("/api/notifications").then((r) => r.notifications) });
  useEffect(() => {
    if (!q.data?.some((n) => n.unread)) return;
    const t = setTimeout(() => api("/api/notifications/read", { method: "POST" }).then(() => qc.setQueryData(["unread"], 0)), 1500);
    return () => clearTimeout(t);
  }, [q.data, qc]);

  return (
    <div className="mx-auto max-w-[620px]">
      <PageTitle>Notifications</PageTitle>
      <FollowRequests />
      {q.isPending ? <Spinner /> : q.isError && !q.data ? <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} /> : !q.data?.length ? <Empty title="Nothing yet">Likes, comments, follows and mentions show up here.</Empty> : (
        <ul data-surface className="divide-y divide-rule overflow-hidden rounded-2xl">
          {q.data.map((n, i) => {
            const first = n.actors[0]!;
            const others = n.total - 1;
            return (
              <li key={i} className={clsx("rise flex items-center gap-3 px-4 py-3", n.unread && "bg-stamp/8")} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <div className="flex -space-x-3">{n.actors.slice(0, 2).map((a) => <span key={a.id} className="rounded-full ring-2 ring-paper"><Avatar user={a} size={36} /></span>)}</div>
                <p className="min-w-0 flex-1 text-[14px]">
                  <Link href={`/u/${first.username}`} className="font-semibold">{first.username}</Link>
                  {others > 0 && <> and {others} other{others > 1 ? "s" : ""}</>} {VERB[n.type]}{n.comment && <span className="text-graphite"> &ldquo;{n.comment.slice(0, 80)}&rdquo;</span>}
                  <span className="ml-1.5 text-graphite">{timeAgo(n.createdAt)}</span>
                </p>
                {n.live?.active && <Link href={`/live/${n.live.id}`} className="shrink-0"><span className="live-badge rounded px-2 py-1 text-[12px] font-bold text-white">Watch</span></Link>}
                {n.post && (
                  <Link href={`/p/${n.post.id}`} className="h-11 w-11 shrink-0 overflow-hidden rounded bg-fog-deep">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {n.post.thumbUrl && <img src={n.post.thumbUrl} alt="" className="h-full w-full object-cover" />}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
