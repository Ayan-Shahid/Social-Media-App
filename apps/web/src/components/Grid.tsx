"use client";
import Link from "next/link";
import type { Post } from "@/lib/types";
import { DateStamp } from "./ui";
import { PlayIcon } from "./icons";

/** Square thumbnails. `sheet` frames it like a film contact sheet (profile). */
export function PostGrid({ posts, sheet }: { posts: Post[]; sheet?: boolean }) {
  const grid = (
    <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
      {posts.map((p) => {
        const m = p.media[0];
        const src = m ? (m.kind === "video" ? m.posterUrl : m.srcset[0]?.url ?? m.url) : null;
        return (
          <Link key={`${p.id}-${p.repostedBy?.id ?? ""}`} href={`/p/${p.id}`} className="group relative block aspect-square overflow-hidden bg-white/40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {src && <img src={src} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />}
            {p.media.length > 1 && <span className="absolute top-2 right-2 rounded bg-black/55 px-1.5 text-[11px] font-semibold text-white">{p.media.length}</span>}
            {m?.kind === "video" && <PlayIcon className="absolute top-2 right-2 h-5 w-5 text-white drop-shadow" />}
            <DateStamp iso={p.createdAt} className="absolute right-1.5 bottom-0.5 text-[11px] sm:text-[13px]" />
          </Link>
        );
      })}
    </div>
  );
  return sheet ? <div className="rounded-sm bg-ink p-1.5 sm:p-3">{grid}</div> : grid;
}
