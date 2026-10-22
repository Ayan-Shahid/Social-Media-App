"use client";
import { useEffect, useState } from "react";

/** Show/hide password. Sits inside the field (pointer events re-enabled on the button itself). */
export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}
      className="pointer-events-auto grid h-7 w-7 place-items-center rounded-md text-graphite hover:text-ink">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" />
        {shown && <path d="m4 4 16 16" />}
      </svg>
    </button>
  );
}

/** True while Caps Lock is on (so a password typo has a reason). */
export function useCapsLock() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (typeof e.getModifierState === "function") setOn(e.getModifierState("CapsLock")); };
    window.addEventListener("keydown", k); window.addEventListener("keyup", k);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("keyup", k); };
  }, []);
  return on;
}
