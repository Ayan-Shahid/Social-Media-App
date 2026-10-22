"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { Alert } from "@/components/Alert";
import { Field, rules } from "@/components/Field";
import { GoogleButton } from "@/components/GoogleButton";
import { PasswordToggle, useCapsLock } from "@/components/PasswordToggle";
import { StagedButton, type Stage } from "@/components/StagedButton";

const IDLE: Stage = { key: "idle", label: "Log in", state: "idle" };

function LoginForm() {
  const { login } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const [error, setError] = useState<string | null>(params.get("error"));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<Stage>(IDLE);
    const [show, setShow] = useState(false);
  const caps = useCapsLock();
  // Shake on error with the Web Animations API: replays every time, and keeps what was typed
  // (re-mounting the form to replay a CSS animation would wipe the fields).
  const shakeForm = () => form.current?.animate(
    [{ transform: "none" }, { transform: "translateX(-7px)" }, { transform: "translateX(6px)" }, { transform: "translateX(-4px)" }, { transform: "translateX(2px)" }, { transform: "none" }],
    { duration: 420, easing: "cubic-bezier(.36,.07,.19,.97)" });
  const form = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (stage.state !== "idle") return;
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")), password = String(f.get("password"));
    const problems = Object.fromEntries(Object.entries({ email: rules.email(email), password: rules.password(password) }).filter(([, v]) => v)) as Record<string, string>;
    setFields(problems); setError(null);
    if (Object.keys(problems).length) { shakeForm(); return; }
    try {
      await login(email, password, (step) => setStage(step === "verify"
        ? { key: "verify", label: "Checking your details…", state: "working" }
        : { key: "unlock", label: "Unlocking your messages…", state: "working" }));
      setStage({ key: "done", label: "Welcome back", state: "done" });
      setTimeout(() => router.replace(safeNext), 550);
    } catch (err) {
      setStage(IDLE);
      shakeForm();
      if (err instanceof ApiError && err.status === 429) setError(err.message);
      else if (err instanceof ApiError && err.status === 401) setFields({ password: "That email and password don't match. Check both and try again." });
      else setError(err instanceof ApiError ? err.message : "Couldn't reach Glimpse. Check your connection and try again.");
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} data-surface className={"auth-card space-y-4 rounded-2xl p-6 sm:p-7"} noValidate>
      <div className="space-y-1">
        <h1 className="display text-[26px] leading-tight">Welcome back</h1>
        <p className="text-[14px] text-graphite">Log in to see what your friends shared.</p>
      </div>
      <Alert tone="error" title={error ? "Couldn't log in" : undefined}>{error}</Alert>
      <GoogleButton next={safeNext} />
      <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" required validate={rules.email} error={fields.email} autoFocus />
      <Field label="Password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required validate={rules.password} error={fields.password}
        trailing={<PasswordToggle shown={show} onToggle={() => setShow((s) => !s)} />}
        hint={caps ? <span className="font-medium text-stamp-ink">Caps Lock is on</span> : undefined} />
      <StagedButton stage={stage} />
      <p className="text-center text-[14px] text-graphite">New here? <Link href="/register" className="font-semibold text-ink underline-offset-4 hover:underline">Create an account</Link></p>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
