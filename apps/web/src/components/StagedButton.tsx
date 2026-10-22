"use client";
// A submit button that narrates real progress: each stage's label slides in, a spinner while
// working, a drawn check mark when done. The stages are the actual steps (e.g. signing in, then
// unlocking the message key in this browser), not a fake timer.
import clsx from "clsx";
import { Spinner } from "./ui";

export type Stage = { key: string; label: string; state: "idle" | "working" | "done" };

export function StagedButton({ stage, className, variant = "ink", disabled }: { stage: Stage; className?: string; variant?: "ink" | "stamp"; disabled?: boolean }) {
  const busy = stage.state !== "idle";
  return (
    <button type="submit" disabled={disabled || busy} aria-busy={stage.state === "working" || undefined} data-loading={stage.state === "working" ? "true" : undefined}
      className={clsx("btn relative h-12 w-full overflow-hidden", `btn-${variant}`, stage.state === "done" && "btn-done", className)}>
      <span key={stage.key} className="label-in" aria-live="polite">
        {stage.state === "working" && <Spinner className="h-4 w-4 border-2 border-current/30 border-t-current" />}
        {stage.state === "done" && (
          <svg viewBox="0 0 24 24" className="check-draw h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        )}
        {stage.label}
      </span>
      {stage.state === "working" && <span aria-hidden className="progress-sweep absolute inset-x-0 bottom-0 h-[2px]" />}
    </button>
  );
}
