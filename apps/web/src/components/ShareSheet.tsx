"use client";
// "Send to…": share a post into one or more chats. Each recipient gets its own encrypted message
// (one per conversation), so the server sees N ciphertexts and nothing about the post.
import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { newIdempotencyKey } from "@/lib/api";
import { openDirect, sendEnvelope } from "@/lib/chat";
import { useSession } from "@/lib/session";
import type { Conversation, Post, User } from "@/lib/types";
import { Button } from "./Button";
import { convName, GroupAvatar, PeoplePicker, Sheet, useConversations } from "./Messages";
import { Avatar, ErrorText } from "./ui";

type Target = { key: string; conv?: Conversation; user?: User };

export function ShareSheet({ post, onClose }: { post: Post; onClose: () => void }) {
  const { privateKey, me } = useSession();
  const qc = useQueryClient();
  const convs = useConversations();
  const [picked, setPicked] = useState<Target[]>([]);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const toggle = (t: Target) => setPicked((p) => (p.some((x) => x.key === t.key) ? p.filter((x) => x.key !== t.key) : [...p, t]));
  const isPicked = (k: string) => picked.some((x) => x.key === k);

  async function send() {
    if (!privateKey) return;
    setState("sending"); setError(null);
    const failed: string[] = [];
    // One idempotency key per recipient: a retry after a partial failure re-sends only what's missing.
    await Promise.all(picked.map(async (t) => {
      try {
        const conv = t.conv ?? await openDirect(t.user!.id);
        await sendEnvelope(qc, conv, { t: "post", postId: post.id, ...(note.trim() && { text: note.trim().slice(0, 1000) }) }, privateKey, `${t.key}-${post.id}-${note.length}`);
      } catch { failed.push(t.conv ? convName(t.conv) : t.user!.username); }
    }));
    if (failed.length) { setError(`Couldn't send to ${failed.join(", ")}.`); setState("idle"); }
    else { setState("sent"); setTimeout(onClose, 900); }
  }

  return (
    <Sheet title="Send to…" onClose={onClose}>
      {!privateKey ? (
        <p className="text-[14px] text-graphite">Messages are end-to-end encrypted. <Link href="/messages" className="font-semibold text-ink underline">Unlock them on this device</Link> to share.</p>
      ) : (
        <>
          {!!convs.data?.length && (
            <ul className="-mx-2 grid max-h-56 grid-cols-4 gap-1 overflow-y-auto sm:grid-cols-5">
              {convs.data.filter((c) => c.myRole).slice(0, 20).map((c) => {
                const k = `c:${c.id}`;
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => toggle({ key: k, conv: c })} aria-pressed={isPicked(k)}
                      className={clsx("flex w-full flex-col items-center gap-1 rounded-xl p-2 text-[12px] transition", isPicked(k) ? "bg-ink/8 ring-2 ring-ink" : "hover:bg-fog")}>
                      {c.kind === "group" ? <GroupAvatar c={c} size={48} /> : c.otherUser && <Avatar user={c.otherUser} size={48} />}
                      <span className="w-full truncate text-center">{convName(c)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <PeoplePicker exclude={[me?.id ?? ""]} picked={picked.flatMap((p) => (p.user ? [p.user] : []))} onPick={(u) => toggle({ key: `u:${u.id}`, user: u })} />
          {picked.length > 0 && (
            <p className="text-[13px] text-graphite">To: {picked.map((p) => (p.conv ? convName(p.conv) : p.user!.username)).join(", ")}</p>
          )}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Write a message…" aria-label="Message" className="field" />
          <ErrorText>{error}</ErrorText>
          <Button type="button" className="w-full" disabled={!picked.length || state === "sent"} loading={state === "sending"} onClick={send}>
            {state === "sent" ? "Sent ✓" : picked.length > 1 ? `Send separately to ${picked.length}` : "Send"}
          </Button>
        </>
      )}
    </Sheet>
  );
}
