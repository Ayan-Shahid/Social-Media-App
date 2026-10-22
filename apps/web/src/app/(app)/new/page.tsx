"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import type { Post } from "@/lib/types";
import { ACCEPT, useMediaStatus, useUploads, type UploadItem } from "@/components/Uploader";
import { Button } from "@/components/Button";
import { ErrorText, PageTitle, Spinner } from "@/components/ui";
import { CloseIcon, ImageIcon } from "@/components/icons";

function Tile({ item, onRemove, onRetry, onStatus }: { item: UploadItem; onRemove: () => void; onRetry: () => void; onStatus: (ready: boolean, failed: boolean) => void }) {
  const status = useMediaStatus(item.mediaId);
  const m = status.data;
  const ready = m?.status === "ready", failed = m?.status === "failed" || !!item.error;
  useEffect(() => { onStatus(ready, failed); }, [ready, failed]); // eslint-disable-line react-hooks/exhaustive-deps
  const isVideo = item.file.type.startsWith("video/");
  return (
    <div className="relative aspect-square overflow-hidden rounded-md bg-fog-deep">
      {isVideo ? <video src={item.preview} muted className="h-full w-full object-cover" /> : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.preview} alt="" className="h-full w-full object-cover" />
      )}
      {!ready && !failed && (
        <span className="absolute inset-0 grid place-items-center bg-white/55 text-center text-[12px] font-semibold backdrop-blur-[1px]">
          <span className="flex flex-col items-center gap-1.5"><Spinner className="h-4 w-4" />{item.mediaId ? (isVideo ? "Encoding video…" : "Processing…") : `Uploading ${Math.round(item.progress * 100)}%`}</span>
          {!item.mediaId && <span className="absolute inset-x-0 bottom-0 h-1 bg-ink/10"><span className="block h-full bg-stamp transition-[width] duration-200" style={{ width: `${item.progress * 100}%` }} /></span>}
        </span>
      )}
      {failed && (
        <span className="absolute inset-0 grid place-items-center bg-white/85 p-2 text-center text-[12px] text-heart">
          <span>{item.error ?? m?.error ?? "Failed"}{item.error && <button onClick={onRetry} className="mt-1 block w-full font-semibold underline">Retry</button>}</span>
        </span>
      )}
      <button onClick={onRemove} aria-label="Remove" className="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white"><CloseIcon className="h-4 w-4" /></button>
    </div>
  );
}

function NewPost() {
  const router = useRouter();
  const qc = useQueryClient();
  const [kind, setKind] = useState<"post" | "short">(useSearchParams().get("kind") === "short" ? "short" : "post");
  const up = useUploads(kind === "short" ? "short" : "post", kind === "short" ? 1 : 10);
  const [states, setStates] = useState<Record<string, { ready: boolean; failed: boolean }>>({});
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const shareKey = useRef(newIdempotencyKey()); // one key per post attempt: double clicks make one post
  const allReady = up.items.length > 0 && up.items.every((i) => states[i.localId]?.ready);

  async function share() {
    if (!allReady || sharing) return;
    setSharing(true); setError(null);
    try {
      const r = await api<{ post: Post }>("/api/posts", { method: "POST", idempotencyKey: shareKey.current, body: { mediaIds: up.items.map((i) => i.mediaId), caption, kind } });
      try { sessionStorage.setItem(`develop:${r.post.id}`, "1"); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ["feed"] });
      router.push(kind === "short" ? "/shorts" : `/p/${r.post.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't share. Try again.");
      setSharing(false);
    }
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <PageTitle right={
        <div className="flex rounded-full border border-rule bg-white/60 p-0.5 text-[13px] font-semibold">
          {(["post", "short"] as const).map((k) => (
            <button key={k} onClick={() => { if (k !== kind) { up.reset(); setStates({}); setKind(k); } }}
              className={clsx("rounded-full px-3 py-1 transition", kind === k ? "bg-ink text-white" : "text-graphite")}>{k === "post" ? "Post" : "Short"}</button>
          ))}
          <Link href="/live/new" className="rounded-full px-3 py-1 text-graphite transition hover:text-ink">Live</Link>
        </div>
      }>New {kind}</PageTitle>
      <div data-surface className="rounded-2xl p-4">
        {up.items.length === 0 ? (
          <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-rule text-graphite transition hover:border-ink hover:text-ink">
            <ImageIcon className="h-10 w-10" />
            <span className="text-[15px] font-semibold">{kind === "short" ? "Choose a vertical video" : "Choose photos or videos"}</span>
            <span className="px-6 text-center text-[13px]">{kind === "short" ? "MP4, MOV or WebM, up to 60 seconds" : "Up to 10. Photos up to 10 MB, videos up to 60 s"}</span>
            <input type="file" multiple={kind === "post"} accept={ACCEPT[kind === "short" ? "short" : "post"]} className="sr-only" onChange={(e) => { if (e.target.files) up.add(e.target.files); e.target.value = ""; }} />
          </label>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {up.items.map((it) => (
              <Tile key={it.localId} item={it} onRemove={() => up.remove(it.localId)} onRetry={() => up.retry(it)}
                onStatus={(ready, failed) => setStates((s) => (s[it.localId]?.ready === ready && s[it.localId]?.failed === failed ? s : { ...s, [it.localId]: { ready, failed } }))} />
            ))}
            {kind === "post" && up.items.length < 10 && (
              <label className="grid aspect-square cursor-pointer place-items-center rounded-md border-2 border-dashed border-rule text-[28px] text-graphite hover:border-ink">
                +<input type="file" multiple accept={ACCEPT.post} className="sr-only" onChange={(e) => { if (e.target.files) up.add(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
        )}
        <div className="mt-4 space-y-3">
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={3} placeholder="Write a caption… use @ to mention and # for tags" aria-label="Caption" className="field resize-none" />
          <ErrorText>{error}</ErrorText>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-graphite">{up.items.length > 0 && !allReady ? "You can share once processing finishes." : " "}</span>
            <Button variant="stamp" onClick={share} disabled={!allReady} loading={sharing}>Share</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewPostPage() { return <Suspense><NewPost /></Suspense>; }
