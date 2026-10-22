"use client";
// Uploads files and follows their processing (DECISIONS.md D14):
//   1. ask the API for a signed upload URL (declaring type and size)
//   2. PUT the file straight to object storage, with progress
//   3. tell the API it's complete; a worker processes it and pushes `media:status` over the WebSocket
//      (with polling as a fallback).
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import type { Media } from "@/lib/types";

export type Purpose = "post" | "avatar" | "story" | "short";
export const ACCEPT: Record<Purpose, string> = {
  post: "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/quicktime,video/webm",
  short: "video/mp4,video/quicktime,video/webm",
  story: "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm",
  avatar: "image/jpeg,image/png,image/webp,image/heic",
};

export interface UploadItem { localId: string; file: File; preview: string; mediaId: string | null; error: string | null; progress: number }

type Slot = { media: Media; upload: { url: string; method: "PUT"; headers: Record<string, string> } };

/** PUT with upload progress (fetch can't report upload progress yet; XHR can). */
function put(url: string, file: File, headers: Record<string, string>, onProgress?: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new ApiError(x.status, "The upload was refused. Try again.")));
    x.onerror = () => reject(new ApiError(0, "Upload failed. Check your connection."));
    x.send(file);
  });
}

/** Steps 1-3. Returns the media row (status "processing"). The key makes a retried click safe. */
export async function directUpload(file: File, purpose: Purpose, idempotencyKey: string, onProgress?: (p: number) => void): Promise<Media> {
  const slot = await api<Slot>("/api/media/uploads", { method: "POST", body: { purpose, mime: file.type || "application/octet-stream", size: file.size }, idempotencyKey });
  if (slot.media.status === "uploading") {
    await put(slot.upload.url, file, slot.upload.headers, onProgress);
  }
  onProgress?.(1);
  return (await api<{ media: Media }>(`/api/media/${slot.media.id}/complete`, { method: "POST" })).media;
}

/** Live status of one media item (socket push, poll fallback). */
export function useMediaStatus(mediaId: string | null) {
  return useQuery({
    queryKey: ["media", mediaId],
    queryFn: () => api<{ media: Media }>(`/api/media/${mediaId}`).then((r) => r.media),
    enabled: !!mediaId,
    refetchInterval: (q) => (q.state.data?.status === "processing" || q.state.data?.status === "uploading" || !q.state.data ? 3000 : false),
  });
}

export function useUploads(purpose: Purpose, max: number) {
  const qc = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const keys = useRef(new Map<string, string>()); // localId -> Idempotency-Key (reused on retry)
  useEffect(() => () => items.forEach((i) => URL.revokeObjectURL(i.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async (item: UploadItem) => {
    const isVideo = item.file.type.startsWith("video/");
    const maxMb = isVideo ? 60 : 10;
    if (item.file.size > maxMb * 1024 * 1024) {
      setItems((l) => l.map((x) => (x.localId === item.localId ? { ...x, error: `Too large. Max ${maxMb} MB.` } : x)));
      return;
    }
    if (!keys.current.has(item.localId)) keys.current.set(item.localId, newIdempotencyKey());
    const setProgress = (progress: number) => setItems((l) => l.map((x) => (x.localId === item.localId ? { ...x, progress } : x)));
    try {
      const m = await directUpload(item.file, purpose, keys.current.get(item.localId)!, setProgress);
      qc.setQueryData(["media", m.id], m);
      setItems((l) => l.map((x) => (x.localId === item.localId ? { ...x, mediaId: m.id, error: null } : x)));
    } catch (e) {
      // A refused file won't upload on retry; a new key gets a new signed URL for real retries.
      keys.current.delete(item.localId);
      setItems((l) => l.map((x) => (x.localId === item.localId ? { ...x, progress: 0, error: e instanceof ApiError ? e.message : "Upload failed." } : x)));
    }
  }, [purpose, qc]);

  const add = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).slice(0, Math.max(0, max - items.length)).map((file) => ({ localId: crypto.randomUUID(), file, preview: URL.createObjectURL(file), mediaId: null, error: null, progress: 0 }));
    setItems((l) => [...l, ...list]);
    list.forEach(send);
  }, [items.length, max, send]);

  const remove = (localId: string) => setItems((l) => l.filter((x) => x.localId !== localId));
  const retry = (item: UploadItem) => { setItems((l) => l.map((x) => (x.localId === item.localId ? { ...x, error: null } : x))); send(item); };
  const reset = () => { items.forEach((i) => URL.revokeObjectURL(i.preview)); setItems([]); keys.current.clear(); };
  return { items, add, remove, retry, reset };
}

/** Uploads one file and resolves once it's processed. For avatars and stories. */
export async function uploadAndWait(file: File, purpose: Purpose, onProgress?: (p: number) => void): Promise<Media> {
  const r = await directUpload(file, purpose, newIdempotencyKey(), onProgress);
  for (let i = 0; i < 120; i++) {
    const m = await api<{ media: Media }>(`/api/media/${r.id}`).then((x) => x.media);
    if (m.status === "ready") return m;
    if (m.status === "failed") throw new ApiError(415, m.error ?? "Processing failed.");
    await new Promise((res) => setTimeout(res, i < 10 ? 500 : 1500));
  }
  throw new ApiError(504, "Processing is taking too long. Try again.");
}
