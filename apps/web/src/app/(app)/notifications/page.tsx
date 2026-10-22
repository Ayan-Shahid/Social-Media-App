"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/dates";
import type { Notification } from "@/lib/types";
import { Avatar, Empty, PageTitle, Spinner } from "@/components/ui";

const VERB: Record<Notification["type"], string> = {
  like: "liked your post", comment: "commented:", follow: "started following you", mention: "mentioned you", repost: "reposted your post",
};

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
      {q.isPending ? <Spinner /> : !q.data?.length ? <Empty title="Nothing yet">Likes, comments, follows and mentions show up here.</Empty> : (
        <ul data-surface className="divide-y divide-rule overflow-hidden rounded-2xl">
          {q.data.map((n, i) => {
            const first = n.actors[0]!;
            const others = n.total - 1;
            return (
              <li key={i} className={clsx("rise flex items-center gap-3 px-4 py-3", n.unread && "bg-orange-50/60")} style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}>
                <div className="flex -space-x-3">{n.actors.slice(0, 2).map((a) => <span key={a.id} className="rounded-full ring-2 ring-white"><Avatar user={a} size={36} /></span>)}</div>
                <p className="min-w-0 flex-1 text-[14px]">
                  <Link href={`/u/${first.username}`} className="font-semibold">{first.username}</Link>
                  {others > 0 && <> and {others} other{others > 1 ? "s" : ""}</>} {VERB[n.type]}{n.comment && <span className="text-graphite"> &ldquo;{n.comment.slice(0, 80)}&rdquo;</span>}
                  <span className="ml-1.5 text-graphite">{timeAgo(n.createdAt)}</span>
                </p>
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
