"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { Button } from "./Button";

export function FollowButton({ userId, username, following, compact }: { userId: string; username: string; following: boolean; compact?: boolean }) {
  const qc = useQueryClient();
  const [state, setState] = useState(following);
  const m = useMutation({
    mutationFn: (follow: boolean) => api(`/api/users/${userId}/follow`, { method: follow ? "PUT" : "DELETE" }),
    onMutate: (follow) => setState(follow),
    onError: (_e, follow) => setState(!follow),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["profile", username] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["feed"] }), 800); // after fan-out backfill
    },
  });
  if (compact) {
    return (
      <button onClick={() => m.mutate(!state)} disabled={m.isPending} className={clsx("text-[13px] font-semibold transition", state ? "text-graphite" : "text-[#c9500f] hover:text-ink")}>
        {state ? "Following" : "Follow"}
      </button>
    );
  }
  return <Button variant={state ? "line" : "ink"} onClick={() => m.mutate(!state)} loading={m.isPending}>{state ? "Following" : "Follow"}</Button>;
}
