"use client";
// Last resort: the root layout itself failed, so nothing else (providers, theme script) is there.
// Plain styles only, light and dark.
import "./globals.css";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="grid min-h-dvh place-items-center bg-fog p-6 text-ink">
        <main role="alert" className="max-w-[440px] text-center">
          <p className="stamp text-[28px]">Error</p>
          <h1 className="display mt-2 text-xl">Glimpse couldn&apos;t load</h1>
          <p className="mt-2 text-[15px] text-graphite">Something broke before the page could start. Try again, or reload in a minute.</p>
          <div className="mt-6 flex justify-center gap-2">
            <button type="button" onClick={reset} className="btn btn-ink">Try again</button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a full reload is the point here */}
            <a href="/" className="btn btn-line">Reload</a>
          </div>
          {error.digest && <p className="mt-5 text-[12px] text-graphite">Error reference <code className="font-mono">{error.digest}</code></p>}
        </main>
      </body>
    </html>
  );
}
