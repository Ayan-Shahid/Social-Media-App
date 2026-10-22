"use client";
import { useRef, useState } from "react";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import type { Media } from "@/lib/types";

const ACCEPT_POST = "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/quicktime,video/webm";

/** Uploads one file. The server checks the real file type and re-encodes it, so this is only a first filter. */
export function useUpload(purpose: "post" | "avatar") {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<{ file: File; key: string } | null>(null);
  async function upload(file: File): Promise<Media | null> {
    setError(null);
    const isVideo = file.type.startsWith("video/");
    const max = (isVideo ? 60 : 10) * 1024 * 1024;
    if (file.size > max) { setError(`That file is too large. Max ${isVideo ? 60 : 10} MB.`); return null; }
    // Same file retried = same key, so a flaky connection can't create two uploads.
    if (keyRef.current?.file !== file) keyRef.current = { file, key: newIdempotencyKey() };
    const form = new FormData();
    form.append("file", file);
    setBusy(true);
    try {
      const r = await api<{ media: Media }>(`/api/media?purpose=${purpose}`, { method: "POST", form, idempotencyKey: keyRef.current.key });
      return r.media;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed. Check your connection and try again.");
      return null;
    } finally { setBusy(false); }
  }
  return { upload, busy, error, accept: purpose === "avatar" ? "image/jpeg,image/png,image/webp,image/heic" : ACCEPT_POST };
}
