"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";

export function FollowButton({ userId, username, following, compact }: { userId: string; username: string; following: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const [state, setState] = useState(following);
  const m = useMutation({
    mutationFn: (follow: boolean) => api(`/api/users/${userId}/follow`, { method: follow ? "PUT" : "DELETE" }),
    onMutate: (follow) => setState(follow),
    onError: (_e, follow) => setState(!follow),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["profile", username] });
      qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
  if (compact) {
    return (
      <button onClick={() => m.mutate(!state)} disabled={m.isPending} className={clsx("text-[13px] font-semibold", state ? "text-graphite" : "text-stamp")}>
        {state ? "Following" : "Follow"}
      </button>
    );
  }
  return (
    <button onClick={() => m.mutate(!state)} disabled={m.isPending} className={state ? "btn-line" : "btn-ink"}>
      {state ? "Following" : "Follow"}
    </button>
  );
}
