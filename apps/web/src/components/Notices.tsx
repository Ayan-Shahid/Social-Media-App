"use client";
// Short messages that aren't tied to a form, e.g. "You're doing that too fast" when a like is
// rate-limited. Anything can raise one with notice() from lib/api. One at a time, gone after 5 s.
import { useEffect, useState } from "react";
import { Alert } from "./Alert";

type Notice = { message: string; tone: "warning" | "info" | "error"; id: number };

export function Notices() {
  const [n, setN] = useState<Notice | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ message: string; tone: Notice["tone"] }>).detail;
      setN({ ...d, id: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setN(null), 5000);
    };
    window.addEventListener("glimpse:notice", on);
    return () => { window.removeEventListener("glimpse:notice", on); clearTimeout(timer); };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6">
      <div className={n ? "pointer-events-auto w-full max-w-[420px] rounded-xl shadow-lg" : "w-full max-w-[420px]"}>
        <Alert key={n?.id} tone={n?.tone ?? "warning"}>{n?.message}</Alert>
      </div>
    </div>
  );
}
