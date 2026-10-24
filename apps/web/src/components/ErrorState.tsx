"use client";
// What to show when something didn't load. One place decides the wording from what actually went
// wrong, so "not found" is never shown for a server error or a dropped connection:
//   404  -> it doesn't exist (or you can't see it: private accounts look the same, on purpose)
//   403  -> not allowed
//   429  -> slow down, with the wait
//   0    -> offline / unreachable: retries by itself when the connection comes back
//   5xx  -> our side, with Retry and an error reference that matches the server log
import { useEffect } from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import { AlertIcon } from "./Alert";
import { Button } from "./Button";

type Copy = { title: string; body?: React.ReactNode };

export function describe(error: unknown, notFound: Copy = { title: "Not found", body: "It may have been deleted." }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.status === 404) return { kind: "missing" as const, ...notFound };
  if (e?.status === 403) return { kind: "forbidden" as const, title: "Not allowed", body: e.message !== "Not allowed." ? e.message : "You don't have access to this." };
  if (e?.status === 429) return { kind: "slow" as const, title: "Slow down a little", body: e.message };
  if (e?.data.network || e?.status === 0) return navigator.onLine === false
    ? { kind: "offline" as const, title: "You're offline", body: "This will load by itself as soon as you're back online." }
    : { kind: "offline" as const, title: "Couldn't reach Glimpse", body: "Check your connection, or try again in a moment." };
  if (e?.status === 503) return { kind: "server" as const, title: "Glimpse is restarting", body: "It should be back in a few seconds." };
  return { kind: "server" as const, title: "Couldn't load this", body: "Something went wrong on our side. Trying again usually fixes it." };
}

/**
 * A full panel (pages, lists). `onRetry` refetches; it also runs by itself when the browser comes back online.
 * `compact` is a one-line version for inside a list (e.g. the next page of a feed).
 */
export function ErrorState({ error, onRetry, notFound, compact, retrying }: {
  error: unknown; onRetry?: () => void; notFound?: Copy; compact?: boolean; retrying?: boolean;
}) {
  const d = describe(error, notFound);
  const ref = error instanceof ApiError && error.status >= 500 ? error.data.ref : undefined;
  useEffect(() => {
    if (d.kind !== "offline" || !onRetry) return;
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [d.kind, onRetry]);
  const canRetry = !!onRetry && d.kind !== "missing" && d.kind !== "forbidden";

  if (compact) {
    return (
      <div role="alert" className="flex items-center justify-center gap-3 py-6 text-[14px] text-graphite">
        <AlertIcon tone="warning" className="h-[18px] w-[18px] text-stamp-ink" />
        <span>{d.title}.</span>
        {canRetry && <Button size="sm" variant="line" loading={retrying} onClick={onRetry}>Retry</Button>}
      </div>
    );
  }
  return (
    <div data-surface role={d.kind === "missing" ? "status" : "alert"} className="rounded-2xl px-6 py-12 text-center">
      <AlertIcon tone={d.kind === "missing" ? "info" : "warning"} className="mx-auto h-8 w-8 text-graphite" />
      <p className="display mt-3 text-lg">{d.title}</p>
      {d.body && <div className="mx-auto mt-2 max-w-[42ch] text-[15px] text-graphite">{d.body}</div>}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {canRetry && <Button variant="ink" loading={retrying} onClick={onRetry}>Try again</Button>}
        {(d.kind === "missing" || d.kind === "forbidden") && <Link href="/" className="btn btn-line">Back to your feed</Link>}
      </div>
      {ref && <p className="mt-5 text-[12px] text-graphite">Error reference <code className="font-mono">{ref}</code></p>}
    </div>
  );
}

/** A page you can't open (e.g. admin-only), with the reason. */
export function Forbidden({ title = "Admins only", children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div data-surface role="alert" className="mx-auto max-w-[520px] rounded-2xl px-6 py-12 text-center">
      <p className="stamp text-[28px]">403</p>
      <p className="display mt-2 text-lg">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-[42ch] text-[15px] text-graphite">{children}</div>}
      <Link href="/" className="btn btn-line mt-6">Back to your feed</Link>
    </div>
  );
}
