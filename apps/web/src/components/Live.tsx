"use client";
// Live video UI (DECISIONS.md D16): the room overlay (comments, hearts, viewer count) shared by the
// host and viewers, the HLS player for viewers, and the broadcaster that streams the camera.
import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { useRealtime } from "@/lib/realtime";
import type { LiveComment } from "@/lib/types";
import { Avatar } from "./ui";
import { HeartIcon } from "./icons";

/** Joins the room (re-joining every 15 s doubles as the viewer heartbeat) and collects comments/hearts. */
export function useLiveRoom(id: string, onEnded?: () => void) {
  const { socket } = useRealtime();
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [viewers, setViewers] = useState(0);
  const [hearts, setHearts] = useState<{ id: number; x: number; hue: number }[]>([]);
  const [joined, setJoined] = useState<boolean | null>(null);
  const [slow, setSlow] = useState(false);
  const ended = useRef(onEnded);
  ended.current = onEnded;

  const floatHeart = useCallback(() => {
    const h = { id: Date.now() + Math.random(), x: 10 + Math.random() * 70, hue: Math.floor(Math.random() * 40) };
    setHearts((l) => [...l.slice(-24), h]);
    setTimeout(() => setHearts((l) => l.filter((x) => x.id !== h.id)), 2200);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const join = () => socket.emit("live:join", id, (r: { ok: boolean; viewers?: number }) => { setJoined(r.ok); if (r.ok) setViewers(r.viewers ?? 0); });
    if (socket.connected) join(); else socket.once("connect", join);
    socket.io.on("reconnect", join);
    const t = setInterval(join, 15_000);
    const onComment = (c: LiveComment & { id: string }) => setComments((l) => [...l.slice(-60), c]);
    const onHeart = () => floatHeart();
    const onEnd = (e: { id: string }) => { if (e.id === id) ended.current?.(); };
    const onSlow = () => { setSlow(true); setTimeout(() => setSlow(false), 4000); };
    socket.on("live:comment", onComment);
    socket.on("live:heart", onHeart);
    socket.on("live:ended", onEnd);
    socket.on("live:slowdown", onSlow);
    return () => {
      clearInterval(t);
      socket.io.off("reconnect", join);
      socket.off("live:comment", onComment); socket.off("live:heart", onHeart); socket.off("live:ended", onEnd); socket.off("live:slowdown", onSlow);
      socket.emit("live:leave", id);
    };
  }, [socket, id, floatHeart]);

  const comment = (text: string) => socket?.emit("live:comment", { id, text });
  const heart = () => { floatHeart(); socket?.emit("live:heart", id); };
  return { comments, viewers, hearts, joined, slow, comment, heart };
}

/** Comments rising from the bottom, hearts floating up on the right, a comment box and a heart button. */
export function LiveOverlay({ room, canInteract = true }: { room: ReturnType<typeof useLiveRoom>; canInteract?: boolean }) {
  const [text, setText] = useState("");
  return (
    <>
      <div className="pointer-events-none absolute right-2 bottom-24 h-72 w-16">
        {room.hearts.map((h) => (
          <HeartIcon key={h.id} filled className="heart-float absolute bottom-0 h-8 w-8 drop-shadow" style={{ left: `${h.x}%`, color: `hsl(${350 + h.hue} 90% 60%)` }} />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-3 pt-24 pb-3">
        <ul className="mb-3 max-h-48 space-y-1.5 overflow-hidden [mask-image:linear-gradient(to_top,black_70%,transparent)]" aria-live="polite">
          {room.comments.map((c) => (
            <li key={c.id} className="rise flex items-start gap-2 text-[14px] text-white">
              <Avatar user={c.user} size={24} />
              <span className="min-w-0 break-words [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]"><b className="mr-1.5">{c.user.username}</b>{c.text}</span>
            </li>
          ))}
        </ul>
        {canInteract && (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { room.comment(text.trim()); setText(""); } }}>
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder={room.slow ? "Slow down a little…" : "Comment…"} aria-label="Comment"
              className="h-11 min-w-0 flex-1 rounded-full border border-white/50 bg-black/20 px-4 text-[14px] text-white placeholder:text-white/60 focus:border-white focus:outline-none" />
            <button type="button" onClick={room.heart} aria-label="Send a heart" className="grid h-11 w-11 place-items-center rounded-full text-white transition active:scale-75">
              <HeartIcon filled className="h-7 w-7 text-heart" />
            </button>
          </form>
        )}
      </div>
    </>
  );
}

export function LiveBadge({ viewers, className }: { viewers?: number; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 text-[12px] font-bold text-white", className)}>
      <span className="live-badge rounded px-1.5 py-0.5 tracking-wide">LIVE</span>
      {viewers !== undefined && <span className="rounded bg-black/45 px-1.5 py-0.5 tabular-nums">👁 {viewers}</span>}
    </span>
  );
}

/** Low-latency HLS player for viewers. Safari plays HLS natively; others use hls.js (no worker: strict CSP). */
export function LivePlayer({ src, onEnded, muted }: { src: string; onEnded: () => void; muted: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [waiting, setWaiting] = useState(true);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let destroy = () => {};
    const ready = () => setWaiting(false);
    v.addEventListener("playing", ready);
    v.addEventListener("ended", onEnded);
    if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = src; v.play().catch(() => {}); }
    else {
      import("hls.js").then(({ default: Hls }) => {
        if (!Hls.isSupported()) return;
        const h = new Hls({ enableWorker: false, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 5, manifestLoadingRetryDelay: 500, levelLoadingRetryDelay: 500 });
        h.loadSource(src);
        h.attachMedia(v);
        h.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
        // The playlist appears ~2 s after the host connects: keep retrying 404s instead of giving up.
        h.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal && d.type === "networkError") setTimeout(() => h.startLoad(), 1000); });
        destroy = () => h.destroy();
      });
    }
    return () => { v.removeEventListener("playing", ready); v.removeEventListener("ended", onEnded); destroy(); };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <video ref={ref} className="h-full w-full object-cover" playsInline autoPlay muted={muted} />
      {waiting && <span className="absolute inset-0 grid place-items-center text-[14px] text-white/80">Connecting to the live video…</span>}
    </>
  );
}

/** Picks a recording format the browser supports: WebM (Chrome, Firefox) or MP4 (Safari). ffmpeg reads both. */
export function recorderMime() {
  const options = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];
  return options.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}
