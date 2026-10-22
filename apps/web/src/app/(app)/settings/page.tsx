"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { ACCEPT, uploadAndWait } from "@/components/Uploader";
import { Button } from "@/components/Button";
import { Avatar, ErrorText, PageTitle, Spinner } from "@/components/ui";

export default function SettingsPage() {
  const { me, chatKeys } = useSession();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  if (!me) return null;

  async function save(patch: Record<string, unknown>, ok: string) {
    setBusy(true); setStatus({});
    try {
      const r = await api<{ user: User }>("/api/users/me", { method: "PATCH", body: patch });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["profile", r.user.username] });
      setStatus({ ok });
    } catch (e) { setStatus({ error: e instanceof ApiError ? e.message : "Couldn't save." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-[520px]">
      <PageTitle>Edit profile</PageTitle>
      <div data-surface className="space-y-6 rounded-2xl p-6">
        <div className="flex items-center gap-5">
          <Avatar user={me} size={80} />
          <label className="btn btn-line cursor-pointer" data-loading={uploading || undefined}>
            {uploading ? <><Spinner className="h-4 w-4" /> Processing…</> : "Change photo"}
            <input type="file" accept={ACCEPT.avatar} className="sr-only" disabled={uploading} onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
              setUploading(true); setStatus({});
              try { const m = await uploadAndWait(f, "avatar"); await save({ avatarMediaId: m.id }, "Profile photo updated."); }
              catch (err) { setStatus({ error: err instanceof ApiError ? err.message : "Upload failed." }); }
              finally { setUploading(false); }
            }} />
          </label>
        </div>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save({ displayName, bio }, "Profile saved."); }}>
          <label className="block space-y-1.5"><span className="label">Name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} className="field" /></label>
          <label className="block space-y-1.5"><span className="label">Bio</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={4} className="field resize-none" />
            <span className="block text-right text-[12px] text-graphite tabular-nums">{bio.length}/300</span></label>
          <ErrorText>{status.error}</ErrorText>
          {status.ok && <p className="text-[13px] font-medium text-emerald-700" role="status">{status.ok}</p>}
          <Button loading={busy}>Save profile</Button>
        </form>
        <p className="border-t border-rule pt-4 text-[13px] text-graphite">
          Message key: {chatKeys === "password" ? "protected by your password." : chatKeys === "passcode" ? "protected by your chat passcode." : "not set up yet. Open Messages to set a chat passcode."}
        </p>
      </div>
    </div>
  );
}
