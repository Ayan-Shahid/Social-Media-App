"use client";
// The page itself failed (a bug threw while rendering). Used by the error.tsx boundaries.
// "Try again" re-renders just the broken part, keeping the rest of the app (and what you typed) in place.
import { useEffect } from "react";
import Link from "next/link";

export function CrashPanel({ error, reset, full }: { error: Error & { digest?: string }; reset: () => void; full?: boolean }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className={full ? "grid min-h-dvh place-items-center p-6" : "py-6"}>
      <div data-surface role="alert" className="mx-auto max-w-[460px] rounded-2xl px-6 py-12 text-center">
        <p className="stamp text-[28px]">Error</p>
        <p className="display mt-2 text-xl">Something went wrong on our side</p>
        <p className="mx-auto mt-2 max-w-[38ch] text-[15px] text-graphite">This part of Glimpse hit an error. Trying again usually fixes it; if it keeps happening, reloading the page will.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className="btn btn-ink">Try again</button>
          <Link href="/" className="btn btn-line">Back to your feed</Link>
        </div>
        {error.digest && <p className="mt-5 text-[12px] text-graphite">Error reference <code className="font-mono">{error.digest}</code></p>}
      </div>
    </div>
  );
}
