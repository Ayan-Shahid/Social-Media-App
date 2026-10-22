"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { tellOtherTabs, useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { ACCEPT, uploadAndWait } from "@/components/Uploader";
import { Button } from "@/components/Button";
import { Avatar, ErrorText, PageTitle, Spinner } from "@/components/ui";
import { Switch } from "@/components/Switch";
import { type ThemePref, useThemePref } from "@/lib/theme";
import clsx from "clsx";

export default function SettingsPage() {
  const { me, chatKeys } = useSession();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [isPrivate, setIsPrivate] = useState(!!me?.isPrivate);
  if (!me) return null;

  async function save(patch: Record<string, unknown>, ok: string) {
    setBusy(true); setStatus({});
    try {
      const r = await api<{ user: User }>("/api/users/me", { method: "PATCH", body: patch });
      qc.invalidateQueries({ queryKey: ["me"] });
      tellOtherTabs({ type: "me" });
      qc.invalidateQueries({ queryKey: ["profile", r.user.username] });
      setStatus({ ok });
      return true;
    } catch (e) { setStatus({ error: e instanceof ApiError ? e.message : "Couldn't save." }); return false; }
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
          {status.ok && <p className="text-[13px] font-medium text-good" role="status">{status.ok}</p>}
          <Button loading={busy}>Save profile</Button>
        </form>
        <p className="border-t border-rule pt-4 text-[13px] text-graphite">
          Message key: {chatKeys === "password" ? "protected by your password." : chatKeys === "passcode" ? "protected by your chat passcode." : "not set up yet. Open Messages to set a chat passcode."}
        </p>
      </div>

      <h2 className="mt-10 mb-3 font-semibold">Appearance</h2>
      <div data-surface className="rounded-2xl p-6"><ThemePicker /></div>

      <h2 className="mt-10 mb-3 font-semibold">Privacy</h2>
      <div data-surface className="space-y-5 rounded-2xl p-6">
        <Switch
          label="Private account"
          checked={isPrivate}
          disabled={busy}
          onChange={async (v) => {
            if (!v && !confirm("Make your account public? Anyone will be able to see your posts, and pending follow requests will be accepted.")) return;
            setIsPrivate(v); // move the switch now; put it back if saving fails
            if (!(await save({ isPrivate: v }, v ? "Your account is private." : "Your account is public."))) setIsPrivate(!v);
          }}
          hint="Only people you approve can see your photos, videos and stories. Your profile name, picture and counts stay visible."
        />
        <Blocked />
      </div>
    </div>
  );
}

function Blocked() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["blocked"], queryFn: () => api<{ users: User[] }>("/api/follow-requests/blocked").then((r) => r.users) });
  const unblock = useMutation({
    mutationFn: (id: string) => api(`/api/users/${id}/block`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocked"] }),
  });
  return (
    <div className="border-t border-rule pt-5">
      <p className="font-semibold">Blocked accounts</p>
      {!q.data?.length ? <p className="mt-0.5 text-[13px] text-graphite">You haven&apos;t blocked anyone.</p> : (
        <ul className="mt-3 space-y-2">
          {q.data.map((u) => (
            <li key={u.id} className="flex items-center gap-3">
              <Avatar user={u} size={32} />
              <span className="min-w-0 flex-1 truncate font-semibold">{u.username}</span>
              <Button size="sm" variant="line" loading={unblock.isPending && unblock.variables === u.id} onClick={() => unblock.mutate(u.id)}>Unblock</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const THEMES: { id: ThemePref; label: string; hint: string }[] = [
  { id: "system", label: "System", hint: "Match this device" },
  { id: "light", label: "Light", hint: "Fog and paper" },
  { id: "dark", label: "Dark", hint: "Darkroom" },
];

/** Theme for this device. Switching animates: the shader cross-fades its palette. */
function ThemePicker() {
  const [pref, setPref] = useThemePref();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
      {THEMES.map((t) => (
        <button key={t.id} role="radio" aria-checked={pref === t.id} onClick={() => setPref(t.id)}
          className={clsx("rounded-xl border p-3 text-left transition", pref === t.id ? "border-ink ring-1 ring-ink" : "border-rule hover:border-graphite")}>
          <span className={clsx("mb-2 block h-10 rounded-lg ring-1 ring-rule", t.id === "light" ? "bg-[#eceef1]" : t.id === "dark" ? "bg-[#0f1115]" : "bg-[linear-gradient(135deg,#eceef1_50%,#0f1115_50%)]")} />
          <span className="block text-[14px] font-semibold">{t.label}</span>
          <span className="block text-[12px] text-graphite">{t.hint}</span>
        </button>
      ))}
    </div>
  );
}
