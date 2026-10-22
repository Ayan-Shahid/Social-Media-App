"use client";
// A labelled input with its own validation: checks on blur (and on submit), marks the input
// aria-invalid, and shows the problem in an Alert under it. Server errors come in via `error`.
import { forwardRef, useId, useState } from "react";
import clsx from "clsx";
import { Alert, AlertIcon } from "./Alert";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string; hint?: React.ReactNode; error?: string | null;
  validate?: (value: string) => string | null; onValidity?: (error: string | null) => void; trailing?: React.ReactNode;
};

export const Field = forwardRef<HTMLInputElement, Props>(function Field({ label, hint, error, validate, onValidity, trailing, className, onBlur, onChange, ...rest }, ref) {
  const id = useId();
  const [local, setLocal] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const shown = error ?? local;
  const check = (v: string) => { const e = validate?.(v) ?? null; setLocal(e); onValidity?.(e); return e; };
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <input ref={ref} id={id} {...rest}
          aria-invalid={touched || error ? !!shown : undefined} aria-describedby={shown ? `${id}-err` : hint ? `${id}-hint` : undefined}
          className={clsx("field", touched && "touched", shown && trailing ? "pr-[4.5rem]" : (shown || trailing) && "pr-10", className)}
          onBlur={(e) => { setTouched(true); check(e.target.value); onBlur?.(e); }}
          onChange={(e) => { if (touched) check(e.target.value); onChange?.(e); }} />
        <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center gap-1.5">
          {shown && <AlertIcon tone="error" className="h-[18px] w-[18px] text-heart" />}
          {trailing}
        </span>
      </div>
      {!shown && hint && <p id={`${id}-hint`} className="text-[12px] text-graphite">{hint}</p>}
      <div id={`${id}-err`}><Alert tone="error" size="sm">{shown}</Alert></div>
    </div>
  );
});

/** Common checks, phrased as the fix rather than the fault. */
export const rules = {
  email: (v: string) => (!v.trim() ? "Enter your email." : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : "That doesn't look like an email address."),
  password: (v: string) => (!v ? "Enter your password." : null),
  newPassword: (v: string) => (v.length < 8 ? `Use at least 8 characters (${8 - v.length} more).` : v.length > 200 ? "That's too long." : null),
  username: (v: string) => (!v.trim() ? "Pick a username." : /^[a-zA-Z0-9_.]{3,30}$/.test(v.trim()) ? null : "3–30 letters, numbers, dots or underscores."),
};
