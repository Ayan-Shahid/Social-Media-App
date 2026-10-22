"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { SessionProvider } from "@/lib/session";
import { RealtimeProvider } from "@/lib/realtime";
import { ApiError } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, // Coming back to a tab (or the phone after using the desktop) refreshes anything older than staleTime.
      refetchOnWindowFocus: true, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 },
      mutations: { retry: 0 },
    },
  }));
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <RealtimeProvider>{children}</RealtimeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
