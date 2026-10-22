"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { clockTime, timeAgo } from "@/lib/dates";
import { decryptMessage, encryptMessage, safetyCode } from "@/lib/e2ee";
import { usePresence } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import type { Conversation, EncryptedMessage } from "@/lib/types";
import { Avatar, Empty, ErrorText, Spinner } from "./ui";
import { BackIcon, LockIcon, SendIcon } from "./icons";

export function useConversations() {
  return useQuery({ queryKey: ["conversations"], queryFn: () => api<{ conversations: Conversation[] }>("/api/conversations").then((r) => r.conversations) });
}

export function ConversationList({ activeId }: { activeId?: string }) {
  const q = useConversations();
  const isOnline = usePresence(q.data?.map((c) => c.otherUser.id) ?? []);
  if (q.isPending) return <div className="p-6"><Spinner /></div>;
  if (!q.data?.length) return <p className="p-5 text-[14px] text-graphite">No conversations yet. Open someone&apos;s profile and tap Message.</p>;
  return (
    <ul>
      {q.data.map((c) => (
        <li key={c.id}>
          <Link href={`/messages/${c.id}`} className={clsx("flex items-center gap-3 px-4 py-3 transition hover:bg-fog", c.id === activeId && "bg-fog")}>
            <Avatar user={c.otherUser} size={44} online={isOnline(c.otherUser.id)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{c.otherUser.username}</span>
              <span className="flex items-center gap-1 text-[13px] text-graphite"><LockIcon className="h-3 w-3" /> {c.lastMessageAt ? timeAgo(c.lastMessageAt) : "New conversation"}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MessagesShell({ activeId, children }: { activeId?: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto flex h-[calc(100dvh-10rem)] max-w-[960px] overflow-hidden rounded-2xl border border-rule bg-paper md:h-[calc(100dvh-5rem)]">
      <aside className={clsx("w-full shrink-0 overflow-y-auto border-rule md:w-80 md:border-r", activeId && "hidden md:block")}>
        <h1 className="display border-b border-rule px-4 py-4 text-[20px]">Messages</h1>
        <ConversationList activeId={activeId} />
      </aside>
      <section className={clsx("min-w-0 flex-1", !activeId && "hidden md:flex")}>{children}</section>
    </div>
  );
}

function UnlockForm() {
  const { unlock } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="mx-auto max-w-xs space-y-3 text-center" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try { await unlock(String(new FormData(e.currentTarget).get("password"))); }
      catch (err) { setError((err as Error).message); setBusy(false); }
    }}>
      <LockIcon className="mx-auto h-8 w-8" />
      <p className="font-semibold">Unlock your messages on this device</p>
      <p className="text-[13px] text-graphite">Your messages are end-to-end encrypted. Enter your password to unlock your key here. It never leaves this browser.</p>
      <input name="password" type="password" autoComplete="current-password" required className="field" aria-label="Password" />
      <ErrorText>{error}</ErrorText>
      <button className="btn-ink w-full" disabled={busy}>{busy ? "Unlocking…" : "Unlock"}</button>
    </form>
  );
}

type Pending = { key: string; text: string; failed?: boolean };

export function Thread({ id }: { id: string }) {
  const { me, privateKey, myPublicKey } = useSession();
  const qc = useQueryClient();
  const conv = useQuery({ queryKey: ["conversation", id], queryFn: () => api<{ conversation: Conversation }>(`/api/conversations/${id}`).then((r) => r.conversation) });
  const msgs = useQuery({ queryKey: ["messages", id], queryFn: () => api<{ messages: EncryptedMessage[] }>(`/api/conversations/${id}/messages`).then((r) => r.messages) });
  const isOnline = usePresence(conv.data ? [conv.data.otherUser.id] : []);
  const [plain, setPlain] = useState<Record<string, string | null>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const theirKey = conv.data?.otherPublicKey ?? null;

  // Decrypt in the browser. The server only ever had ciphertext.
  useEffect(() => {
    if (!privateKey || !theirKey || !msgs.data) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, string | null> = {};
      for (const m of msgs.data) out[m.id] = plain[m.id] !== undefined ? plain[m.id]! : await decryptMessage(m, theirKey, privateKey);
      if (!cancelled) setPlain(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.data, privateKey, theirKey]);

  useEffect(() => { if (myPublicKey && theirKey) safetyCode(myPublicKey, theirKey).then(setCode); }, [myPublicKey, theirKey]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [plain, pending.length]);

  async function send(item: Pending) {
    if (!privateKey || !theirKey) return;
    setPending((p) => p.map((x) => (x.key === item.key ? { ...x, failed: false } : x)));
    try {
      const enc = await encryptMessage(item.text, theirKey, privateKey);
      // The same key is reused if this message is retried, so it can never be delivered twice.
      const r = await api<{ message: EncryptedMessage }>(`/api/conversations/${id}/messages`, { method: "POST", body: enc, idempotencyKey: item.key });
      setPlain((p) => ({ ...p, [r.message.id]: item.text }));
      qc.setQueryData<EncryptedMessage[]>(["messages", id], (old) => (old && !old.some((x) => x.id === r.message.id) ? [...old, r.message] : old));
      setPending((p) => p.filter((x) => x.key !== item.key));
      qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      setPending((p) => p.map((x) => (x.key === item.key ? { ...x, failed: true } : x)));
      if (e instanceof ApiError && e.status === 422) setPending((p) => p.filter((x) => x.key !== item.key));
    }
  }

  const ordered = useMemo(() => msgs.data ?? [], [msgs.data]);

  if (conv.isError) return <div className="grid flex-1 place-items-center p-6"><Empty title="Conversation not found" /></div>;
  if (!conv.data || !me) return <div className="grid flex-1 place-items-center"><Spinner /></div>;
  const other = conv.data.otherUser;

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center gap-3 border-b border-rule px-4 py-3">
        <Link href="/messages" className="md:hidden" aria-label="Back to messages"><BackIcon className="h-6 w-6" /></Link>
        <Link href={`/u/${other.username}`} className="flex min-w-0 items-center gap-3">
          <Avatar user={other} size={36} online={isOnline(other.id)} />
          <span className="min-w-0">
            <span className="block truncate font-semibold leading-tight">{other.username}</span>
            <span className="text-[12px] text-graphite">{isOnline(other.id) ? "Online" : "Offline"}</span>
          </span>
        </Link>
        <button onClick={() => setShowCode((v) => !v)} className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-fog px-3 py-1.5 text-[12px] font-semibold" aria-expanded={showCode}>
          <LockIcon className="h-3.5 w-3.5" /> Encrypted
        </button>
      </header>
      {showCode && (
        <div className="border-b border-rule bg-fog/60 px-5 py-4 text-[13px]">
          <p className="font-semibold">Only you and {other.username} can read these messages.</p>
          <p className="mt-1 text-graphite">To be sure no one is in the middle, compare this safety code with {other.username} in person or on a call. It should match on both screens.</p>
          <p className="mt-2 font-mono text-[15px] tracking-wider">{code ?? "…"}</p>
        </div>
      )}

      <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-5">
        {!privateKey ? <UnlockForm /> : !theirKey ? (
          <p className="text-center text-[14px] text-graphite">{other.username} hasn&apos;t set up encrypted messages yet.</p>
        ) : msgs.isPending ? <Spinner /> : (
          <>
            {ordered.length === 0 && pending.length === 0 && <p className="py-10 text-center text-[14px] text-graphite">Say hi to {other.username}. Messages are end-to-end encrypted.</p>}
            {ordered.map((m) => {
              const mine = m.senderId === me.id;
              const t = plain[m.id];
              return (
                <div key={m.id} className={clsx("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={clsx("max-w-[75%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug", mine ? "bg-ink text-white" : "bg-fog")} title={clockTime(m.createdAt)}>
                    {t === undefined ? "…" : t === null ? <em className="opacity-70">Can&apos;t decrypt this message</em> : <span className="whitespace-pre-wrap break-words">{t}</span>}
                  </div>
                </div>
              );
            })}
            {pending.map((p) => (
              <div key={p.key} className="flex flex-col items-end">
                <div className="max-w-[75%] rounded-2xl bg-ink/60 px-3.5 py-2 text-[15px] text-white"><span className="whitespace-pre-wrap break-words">{p.text}</span></div>
                {p.failed && <button onClick={() => send(p)} className="mt-1 text-[12px] font-semibold text-heart">Not sent. Tap to retry</button>}
              </div>
            ))}
          </>
        )}
        <div ref={bottom} />
      </div>

      {privateKey && theirKey && (
        <form className="flex items-end gap-2 border-t border-rule p-3" onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          const item = { key: newIdempotencyKey(), text: t.slice(0, 4000) };
          setPending((p) => [...p, item]); setText(""); send(item);
        }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} placeholder="Message…" aria-label="Message"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            className="field min-h-[44px] flex-1 resize-none rounded-full px-4 py-2.5" />
          <button className="btn-ink h-11 w-11 p-0" aria-label="Send" disabled={!text.trim()}><SendIcon className="h-5 w-5" /></button>
        </form>
      )}
    </div>
  );
}
