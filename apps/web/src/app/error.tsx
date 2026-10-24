"use client";
// Errors in pages outside the signed-in app (welcome, login, sign-up), shown full screen.
import { CrashPanel } from "@/components/CrashPanel";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <CrashPanel error={error} reset={reset} full />;
}
