"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { useUpload } from "@/components/Uploader";
import { Avatar, ErrorText, PageTitle, Spinner } from "@/components/ui";

export default function SettingsPage() {
  const { me } = useSession();
  const qc = useQueryClient();
  const up = useUpload("avatar");
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  async function save(patch: Record<string, unknown>, ok: string) {
    setBusy(true); setStatus({});
    try {
      const r = await api<{ user: User }>("/api/users/me", { method: "PATCH", body: patch });
      qc.setQueryData(["me"], r.user);
      qc.invalidateQueries({ queryKey: ["profile", r.user.username] });
      setStatus({ ok });
    } catch (e) { setStatus({ error: e instanceof ApiError ? e.message : "Couldn't save." }); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-[520px]">
      <PageTitle>Edit profile</PageTitle>
      <div className="mb-8 flex items-center gap-5">
        <Avatar user={me} size={80} />
        <div className="space-y-1">
          <label className="btn-line cursor-pointer">
            {up.busy ? <><Spinner className="h-4 w-4" /> Uploading…</> : "Change photo"}
            <input type="file" accept={up.accept} className="sr-only" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              const m = await up.upload(f);
              if (m) await save({ avatarMediaId: m.id }, "Profile photo updated.");
            }} />
          </label>
          <ErrorText>{up.error}</ErrorText>
        </div>
      </div>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save({ displayName, bio }, "Profile saved."); }}>
        <label className="block space-y-1.5"><span className="label">Name</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} className="field" /></label>
        <label className="block space-y-1.5"><span className="label">Bio</span>
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} rows={4} className="field resize-none" />
          <span className="block text-right text-[12px] text-graphite tabular-nums">{bio.length}/300</span></label>
        <ErrorText>{status.error}</ErrorText>
        {status.ok && <p className="text-[13px] font-medium text-emerald-700" role="status">{status.ok}</p>}
        <button className="btn-ink" disabled={busy}>Save profile</button>
      </form>
    </div>
  );
}
