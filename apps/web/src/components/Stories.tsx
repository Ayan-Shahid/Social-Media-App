"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { timeAgo } from "@/lib/dates";
import { useSession } from "@/lib/session";
import type { Story, TrayItem, User } from "@/lib/types";
import { Avatar, Spinner } from "./ui";
import { Photo, Video } from "./Media";
import { CloseIcon } from "./icons";
import { ACCEPT, uploadAndWait } from "./Uploader";

export function StoriesTray() {
  const { me } = useSession();
  const qc = useQueryClient();
  const tray = useQuery({ queryKey: ["stories-tray"], queryFn: () => api<{ tray: TrayItem[] }>("/api/stories/tray").then((r) => r.tray), refetchInterval: 60_000 });
  const [open, setOpen] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  if (!me) return null;
  const list = tray.data ?? [];
  const mine = list.find((t) => t.user.id === me.id);
  const others = list.filter((t) => t.user.id !== me.id);
  const order = mine ? [mine, ...others] : others;

  async function postStory(f: File) {
    setPosting(true); setErr(null);
    try {
      const m = await uploadAndWait(f, "story");
      await api("/api/stories", { method: "POST", body: { mediaId: m.id }, idempotencyKey: newIdempotencyKey() });
      await qc.invalidateQueries({ queryKey: ["stories-tray"] });
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Couldn't post your story."); }
    finally { setPosting(false); }
  }

  return (
    <div className="mb-8">
      <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none]">
        <button onClick={() => (mine ? setOpen(0) : file.current?.click())} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
          <span className="relative">
            <Avatar user={me} size={60} ring={mine ? (mine.allSeen ? "seen" : "unseen") : undefined} />
            <span role="button" tabIndex={0} aria-label="Add to your story" onClick={(e) => { e.stopPropagation(); file.current?.click(); }}
              className="absolute -right-0.5 -bottom-0.5 grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-stamp text-[15px] leading-none font-bold text-white">
              {posting ? <Spinner className="h-3 w-3 border-white/40 border-t-white" /> : "+"}
            </span>
          </span>
          <span className="w-full truncate text-center text-[12px] text-graphite">Your story</span>
        </button>
        <input ref={file} type="file" accept={ACCEPT.story} className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) postStory(f); e.target.value = ""; }} />
        {others.map((t) => (
          <button key={t.user.id} onClick={() => setOpen(order.indexOf(t))} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
            <Avatar user={t.user} size={60} ring={t.allSeen ? "seen" : "unseen"} />
            <span className="w-full truncate text-center text-[12px]">{t.user.username}</span>
          </button>
        ))}
      </div>
      {err && <p className="text-[13px] text-heart">{err}</p>}
      {open !== null && order[open] && (
        <StoryViewer users={order.map((t) => t.user)} start={open} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["stories-tray"] }); }} />
      )}
    </div>
  );
}

const IMAGE_MS = 5000;

/** Full-screen story player: progress bars, tap left/right, auto-advance, marks views. */
export function StoryViewer({ users, start, onClose }: { users: User[]; start: number; onClose: () => void }) {
  const { me } = useSession();
  const [u, setU] = useState(start);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const user = users[u]!;
  const q = useQuery({ queryKey: ["stories", user.id], queryFn: () => api<{ stories: Story[] }>(`/api/stories/user/${user.id}`).then((r) => r.stories) });
  const viewers = useQuery({
    queryKey: ["story-viewers", q.data?.[i]?.id], enabled: user.id === me?.id && !!q.data?.[i],
    queryFn: () => api<{ viewers: User[] }>(`/api/stories/${q.data![i]!.id}/viewers`).then((r) => r.viewers),
  });
  const view = useMutation({ mutationFn: (id: string) => api(`/api/stories/${id}/view`, { method: "POST" }) });
  const story = q.data?.[i];
  const [duration, setDuration] = useState(IMAGE_MS);

  const next = () => {
    if (q.data && i < q.data.length - 1) setI(i + 1);
    else if (u < users.length - 1) { setU(u + 1); setI(0); }
    else onClose();
  };
  const prev = () => { if (i > 0) setI(i - 1); else if (u > 0) { setU(u - 1); setI(0); } };

  useEffect(() => { if (story && !story.seen && user.id !== me?.id) view.mutate(story.id); }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!story || paused) return;
    const ms = story.media.kind === "video" ? duration : IMAGE_MS;
    const t = setTimeout(next, ms);
    return () => clearTimeout(t);
  }, [story?.id, paused, duration]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft") prev(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/92" role="dialog" aria-label={`${user.username}'s story`}>
      <div className="relative h-full max-h-[92dvh] w-full max-w-[420px] overflow-hidden bg-black sm:rounded-2xl"
        onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)}>
        {!q.data ? <div className="grid h-full place-items-center"><Spinner className="border-white/30 border-t-white" /></div> : !story ? (
          <div className="grid h-full place-items-center text-white/70">No story.</div>
        ) : (
          <>
            {story.media.kind === "video"
              ? <Video key={story.id} m={story.media} className="h-full w-full" autoPlay controls={false} onRef={(v) => v && (v.onloadedmetadata = () => setDuration(Math.min(v.duration, 60) * 1000))} />
              : <Photo m={story.media} alt="" className="h-full w-full" priority />}
            <div className="absolute inset-x-3 top-3 flex gap-1">
              {q.data.map((s, n) => (
                <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
                  <span key={`${s.id}-${n === i}`} className="block h-full origin-left bg-white" style={{
                    transform: n < i ? "scaleX(1)" : "scaleX(0)",
                    animation: n === i ? `story-progress ${story.media.kind === "video" ? duration : IMAGE_MS}ms linear forwards` : undefined,
                    animationPlayState: paused ? "paused" : "running",
                  }} />
                </span>
              ))}
            </div>
            <div className="absolute inset-x-3 top-7 flex items-center gap-2 text-white">
              <Avatar user={user} size={30} /><span className="text-[14px] font-semibold">{user.username}</span>
              <span className="text-[13px] text-white/70">{timeAgo(story.createdAt)}</span>
              <button onClick={onClose} className="ml-auto" aria-label="Close"><CloseIcon className="h-6 w-6" /></button>
            </div>
            <button className="absolute inset-y-0 left-0 w-1/3" aria-label="Previous" onClick={prev} />
            <button className="absolute inset-y-0 right-0 w-2/3" aria-label="Next" onClick={next} />
            {user.id === me?.id && (
              <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 px-4 pt-8 pb-4 text-[13px] text-white">
                Seen by {viewers.data?.length ?? 0}{viewers.data?.length ? `: ${viewers.data.slice(0, 3).map((v) => v.username).join(", ")}${viewers.data.length > 3 ? "…" : ""}` : ""}
              </p>
            )}
          </>
        )}
      </div>
      <button onClick={onClose} className={clsx("absolute top-5 right-5 hidden text-white/80 sm:block")} aria-label="Close"><CloseIcon className="h-7 w-7" /></button>
    </div>
  );
}
