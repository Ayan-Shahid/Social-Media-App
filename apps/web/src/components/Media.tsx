"use client";
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import type { Media } from "@/lib/types";

/** A photo with srcset (480/1080 px WebP made by the worker). */
export function Photo({ m, alt, className, priority }: { m: Media; alt: string; className?: string; priority?: boolean }) {
  if (!m.url) return <div className={clsx("bg-fog-deep", className)} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={m.url} srcSet={m.srcset.length ? m.srcset.map((s) => `${s.url} ${s.w}w`).join(", ") : undefined}
      sizes="(max-width: 640px) 100vw, 560px" alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" className={clsx("object-cover", className)} />
  );
}

/** Adaptive video (HLS). Safari plays HLS natively; other browsers use hls.js, loaded only when needed. */
export function Video({ m, className, autoPlay, muted = true, loop, controls = true, onRef }: {
  m: Media; className?: string; autoPlay?: boolean; muted?: boolean; loop?: boolean; controls?: boolean; onRef?: (v: HTMLVideoElement | null) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    onRef?.(v);
    if (!v || !m.hls) return;
    if (v.canPlayType("application/vnd.apple.mpegurl")) { v.src = m.hls; return; }
    let hls: { destroy(): void } | null = null;
    let cancelled = false;
    import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      // enableWorker: false keeps the strict CSP (no blob: workers needed).
      const h = new Hls({ enableWorker: false, capLevelToPlayerSize: true });
      h.loadSource(m.hls!);
      h.attachMedia(v);
      hls = h;
    });
    return () => { cancelled = true; hls?.destroy(); };
  }, [m.hls]); // eslint-disable-line react-hooks/exhaustive-deps
  return <video ref={ref} poster={m.posterUrl ?? undefined} className={clsx("object-cover", className)} playsInline muted={muted} loop={loop} autoPlay={autoPlay} controls={controls} preload="metadata" />;
}

export function MediaItem({ m, alt, className, priority }: { m: Media; alt: string; className?: string; priority?: boolean }) {
  return m.kind === "video" ? <Video m={m} className={className} /> : <Photo m={m} alt={alt} className={className} priority={priority} />;
}

/** Swipeable carousel (CSS scroll-snap) with dots. */
export function Carousel({ media, alt, ratio, priority, onIndex }: { media: Media[]; alt: string; ratio: number; priority?: boolean; onIndex?: (i: number) => void }) {
  const [i, setI] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const go = (n: number) => track.current?.scrollTo({ left: n * track.current.clientWidth, behavior: "smooth" });
  if (media.length === 1) return <div style={{ aspectRatio: ratio }} className="relative overflow-hidden bg-fog-deep"><MediaItem m={media[0]!} alt={alt} className="h-full w-full" priority={priority} /></div>;
  return (
    <div className="relative" style={{ aspectRatio: ratio }}>
      <div ref={track} className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => { const n = Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth); if (n !== i) { setI(n); onIndex?.(n); } }}>
        {media.map((m, n) => (
          <div key={m.id} className="relative h-full w-full shrink-0 snap-center bg-fog-deep">
            <MediaItem m={m} alt={`${alt} (${n + 1} of ${media.length})`} className="h-full w-full" priority={priority && n === 0} />
          </div>
        ))}
      </div>
      {i > 0 && <button onClick={() => go(i - 1)} aria-label="Previous" className="absolute top-1/2 left-2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-lg">‹</button>}
      {i < media.length - 1 && <button onClick={() => go(i + 1)} aria-label="Next" className="absolute top-1/2 right-2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-lg">›</button>}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
        {media.map((m, n) => <span key={m.id} className={clsx("h-1.5 w-1.5 rounded-full transition", n === i ? "bg-white" : "bg-white/50")} />)}
      </div>
      <span className="absolute top-2.5 right-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[12px] font-semibold text-white tabular-nums">{i + 1}/{media.length}</span>
    </div>
  );
}
