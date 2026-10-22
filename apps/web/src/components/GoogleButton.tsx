"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { GoogleIcon } from "./icons";

/** Rendered only when the API has Google credentials configured. A plain link: the API does the redirect dance. */
export function GoogleButton({ next }: { next?: string | null }) {
  const p = useQuery({ queryKey: ["providers"], queryFn: () => api<{ google: boolean }>("/api/auth/providers"), staleTime: Infinity });
  if (!p.data?.google) return null;
  const href = `/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <>
      <a href={href} className="btn btn-line w-full py-3"><GoogleIcon className="h-5 w-5" /> Continue with Google</a>
      <div className="flex items-center gap-3 text-[12px] text-graphite"><span className="h-px flex-1 bg-rule" />or<span className="h-px flex-1 bg-rule" /></div>
    </>
  );
}
