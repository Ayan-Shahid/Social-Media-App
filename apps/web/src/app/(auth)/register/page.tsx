"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ErrorText } from "@/components/ui";
import { Button } from "@/components/Button";
import { GoogleButton } from "@/components/GoogleButton";

export default function RegisterPage() {
  const { register } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    if (password.length < 8) { setFields({ password: "At least 8 characters" }); return; }
    setBusy(true); setError(null); setFields({});
    try {
      await register(String(f.get("username")).trim(), String(f.get("email")).trim(), password);
      router.replace("/");
    } catch (err) {
      if (err instanceof ApiError) { setError(err.fields ? null : err.message); setFields(err.fields ?? {}); }
      else setError("Couldn't create your account. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} data-surface className="space-y-4 rounded-2xl p-6" noValidate>
      <h1 className="display text-[30px] lg:hidden">Glimpse<span className="text-stamp">.</span></h1>
      <h2 className="text-[22px] font-semibold">Create your account</h2>
      <GoogleButton />
      <label className="block space-y-1.5"><span className="label">Username</span>
        <input name="username" autoComplete="username" required pattern="[a-zA-Z0-9_.]{3,30}" className="field" />
        <ErrorText>{fields.username}</ErrorText></label>
      <label className="block space-y-1.5"><span className="label">Email</span>
        <input name="email" type="email" autoComplete="email" required className="field" />
        <ErrorText>{fields.email}</ErrorText></label>
      <label className="block space-y-1.5"><span className="label">Password</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={8} className="field" />
        <ErrorText>{fields.password}</ErrorText></label>
      <p className="text-[13px] leading-snug text-graphite">
        Your password also locks your message key. We can&apos;t read your messages, so if you forget it, old messages can&apos;t be recovered.
      </p>
      <ErrorText>{error}</ErrorText>
      <Button className="w-full py-3" loading={busy}>{busy ? "Setting up your account…" : "Create account"}</Button>
      <p className="text-center text-[14px] text-graphite">Have an account? <Link href="/login" className="font-semibold text-ink">Log in</Link></p>
    </form>
  );
}
