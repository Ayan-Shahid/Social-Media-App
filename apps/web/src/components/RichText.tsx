// Renders @mentions and #hashtags as links. Text is split into tokens and turned into React
// elements; it is NEVER turned into HTML, so a caption can't inject markup.
import Link from "next/link";

const TOKEN = /(@[a-zA-Z0-9_.]{3,30}|#[\p{L}\p{N}_]{1,50})/u;

export function RichText({ text }: { text: string }) {
  const parts = text.split(new RegExp(TOKEN.source, "gu"));
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        const href = p.startsWith("@") ? `/u/${p.slice(1)}` : `/tags/${encodeURIComponent(p.slice(1).toLowerCase())}`;
        return <Link key={i} href={href} className="font-medium text-stamp-ink hover:underline">{p}</Link>;
      })}
    </>
  );
}
