"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { type Envelope, openDirect, REACTIONS, sendEnvelope } from "@/lib/chat";
import { timeAgo } from "@/lib/dates";
import { useSession } from "@/lib/session";
import type { LiveStream, Story, TrayItem, User } from "@/lib/types";
import { Avatar, Spinner } from "./ui";
import { Photo, Video } from "./Media";
import { CloseIcon } from "./icons";
import { ACCEPT, uploadAndWait } from "./Uploader";

export function StoriesTray() {
  const { me } = useSession();
  const qc = useQueryClient();
  const tray = useQuery({ queryKey: ["stories-tray"], queryFn: () => api<{ tray: TrayItem[] }>("/api/stories/tray").then((r) => r.tray), refetchInterval: 60_000 });
  // Who's live right now comes first, like Instagram. Refreshed often, and on "x started a live video".
  const live = useQuery({ queryKey: ["live-now"], queryFn: () => api<{ streams: LiveStream[] }>("/api/live").then((r) => r.streams), refetchInterval: 20_000 });
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
        {(live.data ?? []).filter((l) => l.host.id !== me.id).map((l) => (
          <Link key={l.id} href={`/live/${l.id}`} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5">
            <span className="relative">
              <span className="live-ring block rounded-full p-[3px]"><span className="block rounded-full bg-paper p-[2px]"><Avatar user={l.host} size={54} /></span></span>
              <span className="live-badge absolute -bottom-1 left-1/2 -translate-x-1/2 rounded px-1.5 text-[10px] leading-4 font-bold text-white">LIVE</span>
            </span>
            <span className="w-full truncate text-center text-[12px]">{l.host.username}</span>
          </Link>
        ))}
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
            {user.id !== me?.id && <ReplyBar story={story} owner={user} onFocus={(f) => setPaused(f)} />}
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

/**
 * Reply or react to a story. It arrives as an end-to-end encrypted DM to the story's author, with a
 * small thumbnail of the story, like Instagram. The server can't tell it's a story reply.
 */
function ReplyBar({ story, owner, onFocus }: { story: Story; owner: User; onFocus: (focused: boolean) => void }) {
  const { privateKey } = useSession();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [floating, setFloating] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const thumb = story.media.posterUrl ?? story.media.srcset[0]?.url ?? story.media.url;
  const send = useMutation({
    mutationFn: async (env: Envelope) => sendEnvelope(qc, await openDirect(owner.id), env, privateKey!, newIdempotencyKey()),
    onSuccess: (_m, env) => { setSent(env.t === "story_reaction" ? `Reacted ${env.emoji}` : "Sent"); setTimeout(() => setSent(null), 1600); },
  });
  const react = (emoji: string) => {
    const id = Date.now() + Math.random();
    setFloating((f) => [...f, { id, emoji, x: 20 + Math.random() * 60 }]);
    setTimeout(() => setFloating((f) => f.filter((x) => x.id !== id)), 1400);
    send.mutate({ t: "story_reaction", storyId: story.id, storyOwner: owner.id, thumb, emoji });
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation(); // don't trigger next/prev or pause

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 px-3 pt-10 pb-3" onPointerDown={stop} onPointerUp={stop} onClick={stop}>
      {floating.map((f) => <span key={f.id} className="emoji-float pointer-events-none absolute bottom-20 text-[44px]" style={{ left: `${f.x}%` }}>{f.emoji}</span>)}
      {!privateKey ? (
        <Link href="/messages" className="block text-center text-[13px] text-white/80 underline">Unlock your messages to reply</Link>
      ) : (
        <>
          <div className="mb-2 flex justify-around">
            {REACTIONS.map((e) => (
              <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`} className="text-[26px] transition hover:scale-125 active:scale-90">{e}</button>
            ))}
          </div>
          <form className="flex items-center gap-2" onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            send.mutate({ t: "story_reply", storyId: story.id, storyOwner: owner.id, thumb, text: t.slice(0, 1000) });
            setText("");
          }}>
            <input value={text} onChange={(e) => setText(e.target.value)} onFocus={() => onFocus(true)} onBlur={() => onFocus(false)} maxLength={1000}
              placeholder={`Reply to ${owner.username}…`} aria-label={`Reply to ${owner.username}`}
              className="h-11 flex-1 rounded-full border border-white/50 bg-transparent px-4 text-[14px] text-white placeholder:text-white/60 focus:border-white focus:outline-none" />
            {text.trim() && <button className="text-[14px] font-semibold text-white" disabled={send.isPending}>Send</button>}
          </form>
          <p className="h-5 pt-1 text-center text-[12px] text-white/80" role="status">{send.isError ? "Couldn't send. Try again." : sent ?? ""}</p>
        </>
      )}
    </div>
  );
}
