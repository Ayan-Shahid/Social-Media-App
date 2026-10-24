"use client";
// While the browser is offline, say so once, at the top. Requests that need the network wait (React
// Query pauses them) and run by themselves when the connection is back; what's already loaded stays.
import { useSyncExternalStore } from "react";
import { AlertIcon } from "./Alert";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-3">
      <div className="alert flex items-center gap-2.5 rounded-xl border px-3.5 py-2 text-[13.5px] shadow-lg" data-tone="warning">
        <AlertIcon tone="warning" className="h-[18px] w-[18px] shrink-0" />
        <span><b>You&apos;re offline.</b> Showing what&apos;s already loaded; the rest will load when you&apos;re back.</span>
      </div>
    </div>
  );
}
