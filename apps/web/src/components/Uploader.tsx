"use client";
// Uploads files and follows their processing. The API answers 202 right away; the worker sends
// `media:status` over the WebSocket when done (with polling as a fallback).
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

export interface UploadItem { localId: string; file: File; preview: string; mediaId: string | null; error: string | null }

/** Live status of one media item (socket push, poll fallback). */
export function useMediaStatus(mediaId: string | null) {
  return useQuery({
    queryKey: ["media", mediaId],
    queryFn: () => api<{ media: Media }>(`/api/media/${mediaId}`).then((r) => r.media),
    enabled: !!mediaId,
    refetchInterval: (q) => (q.state.data?.status === "processing" || !q.state.data ? 3000 : false),
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
    const form = new FormData();
    form.append("file", item.file);
    try {
      const r = await api<{ media: Media }>(`/api/media?purpose=${purpose}`, { method: "POST", form, idempotencyKey: keys.current.get(item.localId) });
      qc.setQueryData(["media", r.media.id], r.media);
      setItems((l) => l.map((x) => (x.localId === item.localId ? { ...x, mediaId: r.media.id, error: null } : x)));
    } catch (e) {
      setItems((l) => l.map((x) => (x.localId === item.localId ? { ...x, error: e instanceof ApiError ? e.message : "Upload failed." } : x)));
    }
  }, [purpose, qc]);

  const add = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).slice(0, Math.max(0, max - items.length)).map((file) => ({ localId: crypto.randomUUID(), file, preview: URL.createObjectURL(file), mediaId: null, error: null }));
    setItems((l) => [...l, ...list]);
    list.forEach(send);
  }, [items.length, max, send]);

  const remove = (localId: string) => setItems((l) => l.filter((x) => x.localId !== localId));
  const retry = (item: UploadItem) => { setItems((l) => l.map((x) => (x.localId === item.localId ? { ...x, error: null } : x))); send(item); };
  const reset = () => { items.forEach((i) => URL.revokeObjectURL(i.preview)); setItems([]); keys.current.clear(); };
  return { items, add, remove, retry, reset };
}

/** Uploads one file and resolves once it's processed. For avatars and stories. */
export async function uploadAndWait(file: File, purpose: Purpose): Promise<Media> {
  const form = new FormData();
  form.append("file", file);
  const r = await api<{ media: Media }>(`/api/media?purpose=${purpose}`, { method: "POST", form, idempotencyKey: newIdempotencyKey() });
  for (let i = 0; i < 120; i++) {
    const m = await api<{ media: Media }>(`/api/media/${r.media.id}`).then((x) => x.media);
    if (m.status === "ready") return m;
    if (m.status === "failed") throw new ApiError(415, m.error ?? "Processing failed.");
    await new Promise((res) => setTimeout(res, i < 10 ? 500 : 1500));
  }
  throw new ApiError(504, "Processing is taking too long. Try again.");
}
