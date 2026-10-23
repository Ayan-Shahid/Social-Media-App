"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { Alert } from "@/components/Alert";
import { Field, rules } from "@/components/Field";
import { GoogleButton } from "@/components/GoogleButton";
import { PasswordToggle, useCapsLock } from "@/components/PasswordToggle";
import { StagedButton, type Stage } from "@/components/StagedButton";
import { useTurnstile } from "@/lib/turnstile";

const IDLE: Stage = { key: "idle", label: "Create account", state: "idle" };

export default function RegisterPage() {
  const { register } = useSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<Stage>(IDLE);
    const [show, setShow] = useState(false);
  const [pw, setPw] = useState("");
  const caps = useCapsLock();
  const human = useTurnstile("register");
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
    const username = String(f.get("username")).trim(), email = String(f.get("email")).trim(), password = String(f.get("password"));
    const problems = Object.fromEntries(Object.entries({ username: rules.username(username), email: rules.email(email), password: rules.newPassword(password) }).filter(([, v]) => v)) as Record<string, string>;
    setFields(problems); setError(null);
    if (Object.keys(problems).length) { shakeForm(); return; }
    try {
      let captchaToken: string | undefined;
      if (human.enabled) {
        setStage({ key: "human", label: "Checking you're human…", state: "working" });
        captchaToken = await human.getToken();
      }
      await register(username, email, password, (step) => setStage(step === "keys"
        ? { key: "keys", label: "Creating your encryption keys…", state: "working" }
        : { key: "create", label: "Creating your account…", state: "working" }), captchaToken);
      setStage({ key: "done", label: "Welcome to Glimpse", state: "done" });
      setTimeout(() => router.replace("/"), 600);
    } catch (err) {
      setStage(IDLE);
      shakeForm();
      human.reset(); // tokens are single-use
      if (err instanceof ApiError && err.data.captchaRequired) setError(human.failed
        ? "The human check couldn't load. If you use a content blocker, allow challenges.cloudflare.com and try again."
        : err.message);
      else if (err instanceof ApiError && err.fields) setFields(err.fields);
      else setError(err instanceof ApiError ? err.message : "Couldn't reach Glimpse. Check your connection and try again.");
    }
  }

  const strength = pw.length === 0 ? 0 : pw.length < 8 ? 1 : pw.length < 12 || !/[^a-zA-Z]/.test(pw) ? 2 : 3;

  return (
    <form ref={form} onSubmit={onSubmit} data-surface className={"auth-card space-y-4 rounded-2xl p-6 sm:p-7"} noValidate>
      <div className="space-y-1">
        <h1 className="display text-[26px] leading-tight">Create your account</h1>
        <p className="text-[14px] text-graphite">Photos, shorts, stories, and messages only you and your friends can read.</p>
      </div>
      <Alert tone="error" title={error ? "Couldn't create your account" : undefined}>{error}</Alert>
      <GoogleButton />
      <Field label="Username" name="username" autoComplete="username" required validate={rules.username} error={fields.username} hint="3–30 letters, numbers, dots or underscores." autoFocus />
      <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" required validate={rules.email} error={fields.email} />
      <div>
        <Field label="Password" name="password" type={show ? "text" : "password"} autoComplete="new-password" required validate={rules.newPassword} error={fields.password}
          onChange={(e) => setPw(e.target.value)} trailing={<PasswordToggle shown={show} onToggle={() => setShow((s) => !s)} />}
          hint={caps ? <span className="font-medium text-stamp-ink">Caps Lock is on</span> : "At least 8 characters. It also locks your message key."} />
        <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden>
          {[1, 2, 3].map((n) => <span key={n} className={`h-1 rounded-full transition-colors duration-300 ${strength >= n ? (strength === 1 ? "bg-heart" : strength === 2 ? "bg-stamp" : "bg-good") : "bg-rule"}`} />)}
        </div>
      </div>
      <Alert tone="info" size="sm">We can&apos;t read your messages, so if you forget this password, old messages can&apos;t be recovered.</Alert>
      <div ref={human.ref} className="flex justify-center empty:hidden" />
      <StagedButton stage={stage} />
      <p className="text-center text-[14px] text-graphite">Have an account? <Link href="/login" className="font-semibold text-ink underline-offset-4 hover:underline">Log in</Link></p>
    </form>
  );
}
