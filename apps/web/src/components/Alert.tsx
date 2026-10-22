"use client";
// Messages that need attention: a tinted box with a border and an icon, never bare red text.
// Reveals by growing open (grid-rows trick, so height animates from 0) and fading in.
import clsx from "clsx";

type Tone = "error" | "success" | "info" | "warning";

const ICONS: Record<Tone, React.ReactNode> = {
  error: <path d="M12 8v5M12 16.5v.01M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  warning: <path d="M12 8v5M12 16.5v.01M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20.3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  success: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.7 2.7L16 9.8" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.01" /></>,
};

export function AlertIcon({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {ICONS[tone]}
    </svg>
  );
}

export function Alert({ tone = "error", title, children, size = "md", className }: {
  tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; size?: "md" | "sm"; className?: string;
}) {
  const show = !!(title || children);
  return (
    <div className={clsx("alert-reveal grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out", show ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0", className)}
      aria-live={tone === "error" ? "assertive" : "polite"}>
      <div className="min-h-0 overflow-hidden">
        {show && (
          <div role={tone === "error" ? "alert" : "status"} data-tone={tone}
            className={clsx("alert flex items-start gap-2.5 rounded-xl border", size === "sm" ? "mt-1.5 px-2.5 py-1.5 text-[12.5px]" : "px-3.5 py-2.5 text-[13.5px]")}>
            <AlertIcon tone={tone} className={clsx("shrink-0", size === "sm" ? "mt-px h-4 w-4" : "mt-0.5 h-[18px] w-[18px]")} />
            <div className="min-w-0 leading-snug">
              {title && <p className="font-semibold">{title}</p>}
              {children && <div className={clsx(title && "mt-0.5 opacity-90")}>{children}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
