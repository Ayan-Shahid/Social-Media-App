"use client";
// Go live: camera preview, then stream it. The browser records 0.5 s chunks (MediaRecorder) and sends
// them over a WebSocket to the live service, which turns them into HLS for viewers (DECISIONS.md D16).
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import type { LiveStream } from "@/lib/types";
import { useSession } from "@/lib/session";
import { Button } from "@/components/Button";
import { LiveBadge, LiveOverlay, recorderMime, useLiveRoom } from "@/components/Live";
import { CameraFlipIcon, CloseIcon } from "@/components/icons";
import { Avatar } from "@/components/ui";

type Phase = "preview" | "connecting" | "live" | "ended" | "error";

export default function GoLivePage() {
  const { me } = useSession();
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [phase, setPhase] = useState<Phase>("preview");
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [stream, setStream] = useState<LiveStream | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [summary, setSummary] = useState<{ peak: number; seconds: number } | null>(null);

  // Camera preview (also what gets streamed). Re-acquired when flipping, only before going live.
  useEffect(() => {
    let stopped = false;
    if (phase !== "preview") return;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: { echoCancellation: true, noiseSuppression: true } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        media.current?.getTracks().forEach((t) => t.stop());
        media.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => { setError("Glimpse needs your camera and microphone to go live. Allow them in your browser's site settings."); setPhase("error"); });
    return () => { stopped = true; };
  }, [facing, phase]);

  useEffect(() => () => { rec.current?.state === "recording" && rec.current.stop(); ws.current?.close(); media.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (phase !== "live") return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [phase]);

  async function goLive() {
    if (!media.current) return;
    const mimeType = recorderMime();
    if (!mimeType) { setError("This browser can't record video for live streaming."); setPhase("error"); return; }
    setPhase("connecting"); setError(null);
    try {
      const r = await api<{ stream: LiveStream; ingest: string }>("/api/live", { method: "POST", body: { title }, idempotencyKey: newIdempotencyKey() });
      setStream(r.stream);
      const socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}${r.ingest}`);
      socket.binaryType = "arraybuffer";
      ws.current = socket;
      socket.onopen = () => {
        const recorder = new MediaRecorder(media.current!, { mimeType, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96_000 });
        recorder.ondataavailable = (e) => { if (e.data.size && socket.readyState === WebSocket.OPEN) socket.send(e.data); };
        recorder.start(500); // a chunk every 0.5 s keeps latency down
        rec.current = recorder;
      };
      socket.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as { type: string; message?: string };
        if (m.type === "live") { setPhase("live"); setStartedAt(Date.now()); }
        if (m.type === "error") { setError(m.message ?? "The live video stopped."); }
      };
      socket.onclose = () => { if (rec.current?.state === "recording") rec.current.stop(); setPhase((p) => (p === "live" || p === "connecting" ? "ended" : p)); };
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't start the live video.");
      setPhase("error");
    }
  }

  async function end() {
    if (rec.current?.state === "recording") rec.current.stop();
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send("end");
    const r = stream ? await api<{ peakViewers: number }>(`/api/live/${stream.id}/end`, { method: "POST" }).catch(() => ({ peakViewers: 0 })) : { peakViewers: 0 };
    media.current?.getTracks().forEach((t) => t.stop());
    setSummary({ peak: r.peakViewers, seconds: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0 });
    setPhase("ended");
  }

  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div className="mx-auto max-w-[460px]">
      <div className="relative aspect-[9/16] max-h-[82dvh] w-full overflow-hidden rounded-2xl bg-black">
        <video ref={video} className={`h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`} autoPlay muted playsInline />
        <div className="absolute inset-x-3 top-3 flex items-center gap-2 text-white">
          {me && <Avatar user={me} size={30} />}
          {phase === "live" ? <HostStats id={stream!.id} clock={clock} /> : <span className="text-[14px] font-semibold">{phase === "connecting" ? "Connecting…" : "Live video"}</span>}
          <button onClick={() => (phase === "live" ? end() : router.back())} className="ml-auto" aria-label={phase === "live" ? "End live video" : "Close"}><CloseIcon className="h-6 w-6" /></button>
        </div>

        {phase === "preview" && (
          <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/80 px-4 pt-16 pb-5">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="Add a title…" aria-label="Title"
              className="h-11 w-full rounded-full border border-white/50 bg-black/20 px-4 text-[14px] text-white placeholder:text-white/60 focus:border-white focus:outline-none" />
            <div className="flex items-center gap-3">
              <button onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} aria-label="Switch camera" className="grid h-12 w-12 place-items-center rounded-full bg-white/15 text-white"><CameraFlipIcon className="h-6 w-6" /></button>
              <Button variant="stamp" className="flex-1 py-3" onClick={goLive}>Go live</Button>
            </div>
            <p className="text-center text-[12px] text-white/70">Your followers get a notification. Private account: only approved followers can watch.</p>
          </div>
        )}
        {phase === "connecting" && <div className="absolute inset-0 grid place-items-center bg-black/30"><span className="live-badge rounded px-3 py-1.5 text-[13px] font-bold text-white">Starting…</span></div>}
        {phase === "live" && stream && <HostRoom id={stream.id} onEnd={end} />}
        {(phase === "ended" || phase === "error") && (
          <div className="absolute inset-0 grid place-items-center bg-black/75 p-6 text-center text-white">
            <div className="space-y-3">
              {phase === "ended" ? (
                <>
                  <p className="display text-[22px]">Your live video has ended</p>
                  {summary && <p className="text-[14px] text-white/80">{Math.floor(summary.seconds / 60)} min {summary.seconds % 60} s · up to {summary.peak} {summary.peak === 1 ? "viewer" : "viewers"}</p>}
                </>
              ) : <p className="text-[15px]">{error}</p>}
              <Link href="/" className="btn btn-line">Back to feed</Link>
            </div>
          </div>
        )}
      </div>
      {error && phase !== "error" && <p className="mt-3 text-center text-[13px] text-heart" role="alert">{error}</p>}
    </div>
  );
}

function HostStats({ id, clock }: { id: string; clock: string }) {
  const room = useLiveRoom(id);
  return <><LiveBadge viewers={room.viewers} /><span className="text-[13px] tabular-nums">{clock}</span></>;
}

function HostRoom({ id, onEnd }: { id: string; onEnd: () => void }) {
  const room = useLiveRoom(id);
  return (
    <>
      <LiveOverlay room={room} />
      <button onClick={onEnd} className="absolute top-14 right-3 rounded-full bg-black/50 px-3 py-1 text-[13px] font-semibold text-white">End</button>
    </>
  );
}
