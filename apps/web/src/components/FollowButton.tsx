"use client";
// Follow / Following / Requested. For a private account the API turns "follow" into a request,
// and says so in its answer; the button shows whatever the server decided.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import { Button } from "./Button";

type State = "none" | "following" | "requested";
const label: Record<State, string> = { none: "Follow", following: "Following", requested: "Requested" };

export function FollowButton({ userId, username, following, requested, isPrivate, compact }: {
  userId: string; username: string; following: boolean; requested?: boolean; isPrivate?: boolean; compact?: boolean;
}) {
  const qc = useQueryClient();
  const [state, setState] = useState<State>(following ? "following" : requested ? "requested" : "none");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (follow: boolean) => api<{ following: boolean; requested: boolean }>(`/api/users/${userId}/follow`, { method: follow ? "PUT" : "DELETE" }),
    onMutate: (follow) => { setError(null); setState(follow ? (isPrivate ? "requested" : "following") : "none"); },
    onSuccess: (r) => setState(r.following ? "following" : r.requested ? "requested" : "none"),
    onError: (e, follow) => { setState(follow ? "none" : following ? "following" : "requested"); setError(e instanceof ApiError ? e.message : null); },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["profile", username] });
      qc.invalidateQueries({ queryKey: ["user-posts", username] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["feed"] }), 800); // after fan-out backfill
    },
  });
  const toggle = () => {
    if (state === "following" && isPrivate && !confirm(`Unfollow ${username}? You'll need to request again to see their posts.`)) return;
    m.mutate(state === "none");
  };
  if (compact) {
    return (
      <button onClick={toggle} disabled={m.isPending} className={clsx("text-[13px] font-semibold transition", state === "none" ? "text-stamp-ink hover:text-ink" : "text-graphite")}>
        {label[state]}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <Button variant={state === "none" ? "ink" : "line"} onClick={toggle} loading={m.isPending}>{label[state]}</Button>
      {error && <span className="mt-1 text-[12px] text-heart">{error}</span>}
    </span>
  );
}
