"use client";
// Errors inside the signed-in app: shown in place of the page, with the sidebar still there.
import { CrashPanel } from "@/components/CrashPanel";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashPanel error={error} reset={reset} />;
}
