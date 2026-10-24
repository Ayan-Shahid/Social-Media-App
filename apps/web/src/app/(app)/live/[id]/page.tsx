"use client";
import { ErrorState } from "@/components/ErrorState";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/dates";
import type { LiveStream } from "@/lib/types";
import { LiveBadge, LiveOverlay, LivePlayer, useLiveRoom } from "@/components/Live";
import { CloseIcon, SoundIcon } from "@/components/icons";
import { Avatar, Spinner } from "@/components/ui";

export default function WatchLivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["live", id], queryFn: () => api<{ stream: LiveStream; playlist: string }>(`/api/live/${id}`), retry: false, refetchInterval: (s) => (s.state.data?.stream.status === "starting" ? 2000 : false) });
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(true); // browsers only autoplay muted video
  const onEnded = () => { setEnded(true); qc.invalidateQueries({ queryKey: ["live-now"] }); };
  const room = useLiveRoom(id, onEnded);

  if (q.isPending) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching}
    notFound={{ title: "Live video not available", body: "It may have ended, or it's from a private account you don't follow." }} />;
  const s = q.data.stream;
  const over = ended || s.status === "ended";

  return (
    <div className="mx-auto max-w-[460px]">
      <div className="relative aspect-[9/16] max-h-[82dvh] w-full overflow-hidden rounded-2xl bg-black">
        {!over && s.status === "live" && <LivePlayer src={q.data.playlist} onEnded={onEnded} muted={muted} />}
        {!over && s.status === "starting" && <span className="absolute inset-0 grid place-items-center text-[14px] text-white/80">{s.host.username} is about to go live…</span>}
        <div className="absolute inset-x-3 top-3 flex items-center gap-2 text-white">
          <Link href={`/u/${s.host.username}`} className="flex items-center gap-2"><Avatar user={s.host} size={30} /><span className="text-[14px] font-semibold [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">{s.host.username}</span></Link>
          {!over && <LiveBadge viewers={room.viewers} />}
          <button onClick={() => router.back()} className="ml-auto" aria-label="Close"><CloseIcon className="h-6 w-6" /></button>
        </div>
        {s.title && !over && <p className="absolute inset-x-3 top-12 text-[13px] text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">{s.title}</p>}
        {!over && (
          <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} className="absolute top-20 right-3 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white">
            <SoundIcon filled={!muted} className="h-5 w-5" />
          </button>
        )}
        {over ? (
          <div className="absolute inset-0 grid place-items-center bg-black/75 p-6 text-center text-white">
            <div className="space-y-3">
              <p className="display text-[22px]">This live video has ended</p>
              {s.startedAt && <p className="text-[14px] text-white/75">Started {timeAgo(s.startedAt)}</p>}
              <Link href={`/u/${s.host.username}`} className="btn btn-line">See {s.host.username}&apos;s profile</Link>
            </div>
          </div>
        ) : <LiveOverlay room={room} canInteract={room.joined !== false} />}
      </div>
    </div>
  );
}
