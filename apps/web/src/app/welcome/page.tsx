"use client";
// Public landing page. Everything here is true of this app, and the only numbers are real counts
// from this server (/api/public/stats). No testimonials, no invented users, no made-up metrics.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { isDark, useThemePref } from "@/lib/theme";
import { Camera3D } from "@/components/Camera3D";
import { DateStamp } from "@/components/ui";
import { BellIcon, ChatIcon, HeartIcon, ImageIcon, LiveIcon, LockIcon, MoonIcon, PlayIcon, SunIcon, UsersIcon } from "@/components/icons";

type Stats = { people: number; posts: number; shorts: number; storiesToday: number; liveNow: number; at: string };
const REPO = "https://github.com/Ayan-Shahid/Social-Media-App";

const FEATURES = [
  { icon: ImageIcon, title: "Posts and carousels", body: "Up to ten photos or videos in a post. Every file is re-encoded on the server, so hidden scripts and location data in the original never survive." },
  { icon: PlayIcon, title: "Shorts", body: "Vertical videos, streamed adaptively (HLS at 360p and 720p), so they start quickly on any connection." },
  { icon: BellIcon, title: "Stories", body: "Gone after 24 hours. See who viewed yours, and reply or react straight into a private chat." },
  { icon: LiveIcon, title: "Live video", body: "Go live from your browser's camera. Followers get a notification; comments and hearts arrive in real time." },
  { icon: ChatIcon, title: "Encrypted messages", body: "One-to-one and group chats are encrypted on your device. The server only ever stores ciphertext; compare a safety code to be sure." },
  { icon: UsersIcon, title: "You decide who sees what", body: "A private account with follow requests, remove followers, block and mute. Enforced by the database itself, not only by the app." },
];

const STACK = ["Next.js 16", "React 19", "TypeScript", "Express 5", "PostgreSQL 18 + row-level security", "Redis", "BullMQ", "Socket.IO", "SeaweedFS (S3)", "ffmpeg + HLS", "libsodium", "three.js", "Caddy", "Docker Compose"];

export default function Welcome() {
  const { me } = useSession();
  const stats = useQuery({ queryKey: ["public-stats"], queryFn: () => api<Stats>("/api/public/stats"), staleTime: 60_000, retry: 1 });
  const [shots, setShots] = useState(0);

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-5">
        <Link href="/welcome" className="display text-[24px]">Glimpse<span className="text-stamp">.</span></Link>
        <nav className="flex items-center gap-2">
          <ThemeButton />
          {me ? <Link href="/" className="btn btn-ink">Open your feed</Link> : (
            <>
              <Link href="/login" className="btn btn-line">Log in</Link>
              <Link href="/register" className="btn btn-stamp hidden sm:inline-flex">Create account</Link>
            </>
          )}
        </nav>
      </header>

      <section className="mx-auto grid max-w-[1180px] items-center gap-6 px-5 pt-6 pb-12 lg:grid-cols-[1.05fr_1fr] lg:pt-14">
        <div className="rise space-y-6">
          <p className="stamp text-[15px]">&apos;26 · photos · shorts · stories · live</p>
          <h1 className="display text-[44px] leading-[0.98] sm:text-[64px]">Share the moment.<br />Keep the conversation yours.</h1>
          <p className="max-w-[34rem] text-[17px] leading-relaxed text-graphite">
            Glimpse is a photo and video app for friends: posts, shorts, stories and live video, with messages that are end-to-end encrypted, so only you and the people you talk to can read them.
          </p>
          <div className="flex flex-wrap gap-3">
            {me ? <Link href="/" className="btn btn-stamp px-6 py-3 text-[15px]">Open your feed</Link> : (
              <>
                <Link href="/register" className="btn btn-stamp px-6 py-3 text-[15px]">Create your account</Link>
                <Link href="/login" className="btn btn-line px-6 py-3 text-[15px]">I have an account</Link>
              </>
            )}
          </div>
        </div>
        <div className="relative h-[340px] sm:h-[460px]">
          <Camera3D className="absolute inset-0" onFlash={() => setShots((n) => n + 1)} />
          {shots > 0 && (
            <span key={shots} className="print-out absolute right-[6%] bottom-[2%] block w-32 rotate-[5deg] rounded-[3px] bg-[#fbfaf7] p-2 pb-7 shadow-2xl sm:w-40" aria-hidden>
              <span className="develop-print block aspect-square rounded-[2px] bg-[linear-gradient(135deg,#ff8a3d,#3a1d5e_55%,#ffd36e)]" />
              <DateStamp iso={new Date().toISOString()} className="absolute right-3 bottom-1.5 text-[12px]" />
            </span>
          )}
        </div>
      </section>

      {stats.data && (
        <section className="mx-auto max-w-[1180px] px-5 pb-14" aria-label="Live numbers from this server">
          <div data-surface className="grid grid-cols-2 gap-y-6 rounded-2xl p-6 sm:grid-cols-5">
            {([["people", stats.data.people], ["photo posts", stats.data.posts], ["shorts", stats.data.shorts], ["stories today", stats.data.storiesToday], ["live now", stats.data.liveNow]] as const).map(([label, n]) => (
              <div key={label} className="text-center">
                <p className={clsx("display text-[34px] leading-none tabular-nums", label === "live now" && n > 0 && "text-stamp")}><Count to={n} /></p>
                <p className="mt-1.5 text-[13px] text-graphite">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[12px] text-graphite">Counted from this server&apos;s database, at most a minute ago.</p>
        </section>
      )}

      <section className="mx-auto max-w-[1180px] px-5 pb-16">
        <h2 className="display mb-6 text-[30px]">What you can do</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <article key={title} data-surface className="rise rounded-2xl p-6" style={{ animationDelay: `${i * 60}ms` }}>
              <span className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-ink text-on-ink"><Icon className="h-5 w-5" /></span>
              <h3 className="mb-1.5 text-[17px] font-semibold">{title}</h3>
              <p className="text-[14.5px] leading-relaxed text-graphite">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-5 pb-16">
        <div data-surface className="rounded-2xl p-6 sm:p-8">
          <h2 className="display mb-2 text-[28px]">How your messages stay private</h2>
          <p className="mb-8 max-w-[44rem] text-[15px] text-graphite">Your message key is created in your browser and locked with your password before it ever leaves the device. Glimpse stores the locked copy so you can sign in elsewhere, but can&apos;t open it.</p>
          <ol className="grid gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center">
            <Step icon={<LockIcon className="h-5 w-5" />} title="Your device" body="Encrypts the message with the other person's public key (or the group's current key)." />
            <Arrow />
            <Step icon={<span className="font-mono text-[13px]">a9Xq…</span>} title="Glimpse's servers" body="Store and deliver ciphertext. They can't tell a message from a shared post or a story reply." muted />
            <Arrow />
            <Step icon={<HeartIcon className="h-5 w-5" />} title="Their device" body="Decrypts it. In groups, a fresh key is made whenever someone joins or leaves." />
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-5 pb-16">
        <h2 className="display mb-2 text-[28px]">Built in the open</h2>
        <p className="mb-5 max-w-[46rem] text-[15px] text-graphite">
          Glimpse began as a 2022 MERN project and was rebuilt in 2026: two load-balanced API instances, background workers, a fan-out feed, and privacy rules enforced by PostgreSQL itself. Every design decision, and why, is written down in the repository.
        </p>
        <ul className="mb-6 flex flex-wrap gap-2">{STACK.map((s) => <li key={s} className="chip">{s}</li>)}</ul>
        <div className="flex flex-wrap gap-3">
          <a href={REPO} className="btn btn-line" target="_blank" rel="noreferrer">Source on GitHub</a>
          <a href={`${REPO}/blob/rebuild-2026/docs/v2/DECISIONS.md`} className="btn btn-line" target="_blank" rel="noreferrer">Design decisions</a>
        </div>
      </section>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 px-5 py-8 text-[14px] text-graphite">
          <span><span className="display text-ink">Glimpse<span className="text-stamp">.</span></span> · built by Ayan Shahid</span>
          {!me && <Link href="/register" className="btn btn-stamp">Create your account</Link>}
        </div>
      </footer>
    </div>
  );
}

function Step({ icon, title, body, muted }: { icon: React.ReactNode; title: string; body: string; muted?: boolean }) {
  return (
    <li className={clsx("rounded-xl border border-rule p-4", muted ? "bg-fog/60" : "bg-paper")}>
      <span className="mb-3 grid h-10 min-w-10 place-items-center justify-self-start rounded-lg bg-ink px-2 text-on-ink">{icon}</span>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-[13.5px] text-graphite">{body}</p>
    </li>
  );
}

const Arrow = () => <span aria-hidden className="hidden text-[22px] text-graphite md:block">→</span>;

/** Counts up to the real number once, on first show. */
function Count({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(to); return; }
    const start = performance.now(), dur = 900;
    let raf = 0;
    const step = () => { const p = Math.min(1, (performance.now() - start) / dur); setN(Math.round(to * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{n.toLocaleString()}</>;
}

function ThemeButton() {
  const [pref, setPref] = useThemePref();
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(isDark()); }, [pref]);
  return (
    <button onClick={() => setPref(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} className="grid h-10 w-10 place-items-center rounded-full text-graphite hover:text-ink">
      {dark ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
    </button>
  );
}
