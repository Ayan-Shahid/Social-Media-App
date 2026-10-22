"use client";
// The app's background (DECISIONS.md D10): pre-rendered WebP images of the social-icon shader, light
// and dark, wide and tall. No live WebGL: zero GPU cost, nothing to fall out of sync while scrolling.
// Cards draw their own grid-matrix paper in CSS, so they scroll with their content.
//
// Reactions stay: pulse() floats a few hearts or chat bubbles up from a point on screen (a like, a
// new message, someone going live). Plain DOM + CSS animation, removed when finished.
import { useEffect, useState } from "react";
import { HeartIcon, ChatIcon } from "./icons";

export type PulseKind = "like" | "message" | "live";

export function pulse(kind: PulseKind, x?: number, y?: number) {
  window.dispatchEvent(new CustomEvent("glimpse:pulse", { detail: { kind, x, y } }));
}

type Particle = { id: number; x: number; y: number; dx: number; delay: number; size: number; kind: "heart" | "bubble"; rot: number };

export function Backdrop() {
  const [parts, setParts] = useState<Particle[]>([]);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = (e: Event) => {
      if (reduce.matches) return;
      const d = (e as CustomEvent<{ kind: PulseKind; x?: number; y?: number }>).detail;
      const anchor = d.kind !== "like" ? document.querySelector<HTMLElement>("[data-pulse-anchor='messages']")?.getBoundingClientRect() : null;
      const x = d.x ?? (anchor ? anchor.left + anchor.width / 2 : window.innerWidth - 80);
      const y = d.y ?? (anchor ? anchor.top + anchor.height / 2 : window.innerHeight - 80);
      const now = Date.now();
      const batch: Particle[] = Array.from({ length: 7 }, (_, i) => ({
        id: now + i + Math.random(), x, y, dx: (i - 3) * 22 + (Math.random() - 0.5) * 16, delay: i * 45, size: 14 + Math.random() * 12,
        kind: d.kind === "like" ? "heart" : d.kind === "message" ? "bubble" : i % 2 ? "heart" : "bubble", rot: (Math.random() - 0.5) * 40,
      }));
      setParts((p) => [...p.slice(-30), ...batch]);
      setTimeout(() => setParts((p) => p.filter((q) => !batch.includes(q))), 1700);
    };
    window.addEventListener("glimpse:pulse", on);
    return () => window.removeEventListener("glimpse:pulse", on);
  }, []);
  return (
    <>
      <div aria-hidden className="backdrop" />
      <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
        {parts.map((p) => (
          <span key={p.id} className="float-up absolute" style={{ left: p.x, top: p.y, ["--dx" as string]: `${p.dx}px`, ["--rot" as string]: `${p.rot}deg`, animationDelay: `${p.delay}ms` }}>
            {p.kind === "heart"
              ? <HeartIcon filled className="text-heart drop-shadow" style={{ width: p.size, height: p.size }} />
              : <span className="text-stamp drop-shadow"><ChatIcon className="h-5 w-5" /></span>}
          </span>
        ))}
      </div>
    </>
  );
}
