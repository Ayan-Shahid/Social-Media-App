"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import type { Media, Post } from "@/lib/types";
import { useUpload } from "@/components/Uploader";
import { DateStamp, ErrorText, PageTitle, Spinner } from "@/components/ui";
import { ImageIcon } from "@/components/icons";

export default function NewPostPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const up = useUpload("post");
  const [preview, setPreview] = useState<{ url: string; video: boolean } | null>(null);
  const [media, setMedia] = useState<Media | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  // One key per post attempt: pressing Share twice (or a retry) still makes exactly one post.
  const shareKey = useRef(newIdempotencyKey());

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setMedia(null); setError(null);
    setPreview({ url: URL.createObjectURL(file), video: file.type.startsWith("video/") });
    const m = await up.upload(file);
    if (m) setMedia(m); else setPreview(null);
  }

  async function share() {
    if (!media || sharing) return;
    setSharing(true); setError(null);
    try {
      const r = await api<{ post: Post }>("/api/posts", { method: "POST", body: { mediaId: media.id, caption }, idempotencyKey: shareKey.current });
      await qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["explore"] });
      router.push(`/p/${r.post.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't share. Try again.");
      setSharing(false);
    }
  }

  return (
    <div className="mx-auto max-w-[520px]">
      <PageTitle>New post</PageTitle>
      <div className="print">
        {preview ? (
          <div className="relative aspect-[4/5] overflow-hidden bg-fog-deep">
            {preview.video
              ? <video src={media?.url ?? preview.url} controls playsInline className="h-full w-full object-cover" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={media?.url ?? preview.url} alt="Preview" className="h-full w-full object-cover" />}
            {up.busy && (
              <div className="absolute inset-0 grid place-items-center bg-white/60 backdrop-blur-[2px]">
                <span className="flex items-center gap-2 text-[14px] font-semibold"><Spinner /> Checking and preparing your file…</span>
              </div>
            )}
            {media && <DateStamp iso={new Date().toISOString()} className="absolute right-3 bottom-2.5" />}
          </div>
        ) : (
          <label className="flex aspect-[4/5] cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed border-rule bg-fog/50 text-graphite transition hover:border-ink hover:text-ink">
            <ImageIcon className="h-10 w-10" />
            <span className="text-[15px] font-semibold">Choose a photo or video</span>
            <span className="text-[13px]">JPEG, PNG, WebP, HEIC up to 10 MB · MP4, MOV, WebM up to 60 s</span>
            <input type="file" accept={up.accept} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        )}
        <div className="space-y-3 px-1 py-4">
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} rows={3} placeholder="Write a caption…" aria-label="Caption" className="field resize-none" />
          <ErrorText>{up.error ?? error}</ErrorText>
          <div className="flex items-center justify-between">
            {preview ? <label className="btn-line cursor-pointer">Change<input type="file" accept={up.accept} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} /></label> : <span />}
            <button onClick={share} disabled={!media || sharing || up.busy} className="btn-ink">{sharing ? "Sharing…" : "Share"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
