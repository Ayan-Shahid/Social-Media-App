"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/Button";
import { GoogleButton } from "@/components/GoogleButton";
import { ErrorText } from "@/components/ui";

function LoginForm() {
  const { login } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const [error, setError] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await login(String(f.get("email")), String(f.get("password")));
      router.replace(safeNext);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't log in. Check your connection.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} data-surface className="space-y-4 rounded-2xl p-6" noValidate>
      <h1 className="display text-[30px] lg:hidden">Glimpse<span className="text-stamp">.</span></h1>
      <h2 className="text-[22px] font-semibold">Log in</h2>
      <GoogleButton next={safeNext} />
      <label className="block space-y-1.5"><span className="label">Email</span>
        <input name="email" type="email" autoComplete="email" required className="field" /></label>
      <label className="block space-y-1.5"><span className="label">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className="field" /></label>
      <ErrorText>{error}</ErrorText>
      <Button className="w-full py-3" loading={busy}>{busy ? "Logging in…" : "Log in"}</Button>
      <p className="text-center text-[14px] text-graphite">New here? <Link href="/register" className="font-semibold text-ink">Create an account</Link></p>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
