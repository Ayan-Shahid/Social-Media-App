"use client";
import clsx from "clsx";

/** On/off switch. A real checkbox underneath, so keyboard and screen readers just work. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-wait opacity-60")}>
      <span>
        <span className="block font-semibold">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] text-graphite">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden className="relative mt-0.5 h-7 w-12 shrink-0 rounded-full bg-fog-deep ring-1 ring-rule transition-colors peer-checked:bg-ink peer-focus-visible:outline-2 peer-focus-visible:outline-stamp
        after:absolute after:top-1 after:left-1 after:h-5 after:w-5 after:rounded-full after:bg-paper after:shadow after:transition-transform after:duration-200 after:ease-[cubic-bezier(.3,1.4,.5,1)] peer-checked:after:translate-x-5" />
    </label>
  );
}
