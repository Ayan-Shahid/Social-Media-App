"use client";
// Direct and group chats, end-to-end encrypted in the browser (DECISIONS.md D7).
// The server stores ciphertext and wrapped group keys only; everything here decrypts locally.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { clockTime, timeAgo } from "@/lib/dates";
import { newGroupKey, safetyCode, wrapGroupKey } from "@/lib/e2ee";
import { type Envelope, groupKeysQuery, open, rotate, sendEnvelope } from "@/lib/chat";
import { usePresence } from "@/lib/realtime";
import { useSession } from "@/lib/session";
import type { Conversation, EncryptedMessage, User } from "@/lib/types";
import { Button } from "./Button";
import { MessageBody } from "./MessageBody";
import { Avatar, Empty, ErrorText, Spinner } from "./ui";
import { BackIcon, CloseIcon, LockIcon, PlusIcon, SendIcon, UsersIcon } from "./icons";

const MAX_GROUP = 32;

export function useConversations() {
  return useQuery({ queryKey: ["conversations"], queryFn: () => api<{ conversations: Conversation[] }>("/api/conversations").then((r) => r.conversations) });
}

export const convName = (c: Conversation) => (c.kind === "group" ? c.title ?? "Group" : c.otherUser?.username ?? "Deleted user");

export function GroupAvatar({ c, size }: { c: Conversation; size: number }) {
  const [a, b] = c.members.map((m) => m.user);
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {a && <span className="absolute top-0 left-0"><Avatar user={a} size={size * 0.7} /></span>}
      {b && <span className="absolute right-0 bottom-0 rounded-full ring-2 ring-paper"><Avatar user={b} size={size * 0.7} /></span>}
    </span>
  );
}

export function ConversationList({ activeId }: { activeId?: string }) {
  const q = useConversations();
  const directIds = q.data?.flatMap((c) => (c.otherUser ? [c.otherUser.id] : [])) ?? [];
  const isOnline = usePresence(directIds);
  if (q.isPending) return <div className="p-6"><Spinner /></div>;
  if (!q.data?.length) return <p className="p-5 text-[14px] text-graphite">No conversations yet. Open someone&apos;s profile and tap Message, or start a group.</p>;
  return (
    <ul>
      {q.data.map((c) => (
        <li key={c.id}>
          <Link href={`/messages/${c.id}`} className={clsx("flex items-center gap-3 px-4 py-3 transition hover:bg-paper/50", c.id === activeId && "bg-paper/60")}>
            {c.kind === "group" ? <GroupAvatar c={c} size={44} /> : c.otherUser ? <Avatar user={c.otherUser} size={44} online={isOnline(c.otherUser.id)} /> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{convName(c)}</span>
              <span className="flex items-center gap-1 text-[13px] text-graphite">
                <LockIcon className="h-3 w-3" />
                {c.kind === "group" && <>{c.members.length} people · </>}
                {c.lastMessageAt ? timeAgo(c.lastMessageAt) : "New conversation"}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MessagesShell({ activeId, children }: { activeId?: string; children?: React.ReactNode }) {
  const [creating, setCreating] = useState(false);
  return (
    <div data-surface className="mx-auto flex h-[calc(100dvh-10rem)] max-w-[980px] overflow-hidden rounded-2xl md:h-[calc(100dvh-5rem)]">
      <aside className={clsx("w-full shrink-0 overflow-y-auto border-rule md:w-80 md:border-r", activeId && "hidden md:block")}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-4">
          <h1 className="display text-[20px]">Messages</h1>
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-graphite hover:text-ink" aria-label="New group">
            <PlusIcon className="h-5 w-5" /> Group
          </button>
        </div>
        <ConversationList activeId={activeId} />
      </aside>
      <section className={clsx("relative min-w-0 flex-1", !activeId && "hidden md:flex")}>{children}</section>
      {creating && <NewGroupDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

// ---------- key setup / unlock ----------

function KeyGate() {
  const { unlock, setupPasscode, chatKeys } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = chatKeys === null; // Google account that has never set up chat keys
  const isPasscode = chatKeys === "passcode";
  return (
    <form className="mx-auto max-w-xs space-y-3 py-8 text-center" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const secret = String(f.get("secret"));
      if (setup) {
        if (secret.length < 8) return setError("Use at least 8 characters.");
        if (secret !== String(f.get("confirm"))) return setError("The two passcodes don't match.");
      }
      setBusy(true); setError(null);
      try { await (setup ? setupPasscode(secret) : unlock(secret)); }
      catch (err) { setError(err instanceof ApiError ? err.message : (err as Error).message); setBusy(false); }
    }}>
      <LockIcon className="mx-auto h-8 w-8" />
      <p className="font-semibold">{setup ? "Set a chat passcode" : "Unlock your messages on this device"}</p>
      <p className="text-[13px] text-graphite">
        {setup
          ? "You signed in with Google, so there's no password to protect your message key. Pick a passcode. We can't reset it, and it never leaves this browser."
          : `Messages are end-to-end encrypted. Enter your ${isPasscode ? "chat passcode" : "password"} to unlock your key here. It never leaves this browser.`}
      </p>
      <input name="secret" type="password" autoComplete={setup ? "new-password" : "current-password"} required className="field" aria-label={setup || isPasscode ? "Chat passcode" : "Password"} placeholder={setup || isPasscode ? "Chat passcode" : "Password"} />
      {setup && <input name="confirm" type="password" autoComplete="new-password" required className="field" aria-label="Confirm passcode" placeholder="Confirm passcode" />}
      <ErrorText>{error}</ErrorText>
      <Button className="w-full" loading={busy}>{setup ? "Set passcode" : "Unlock"}</Button>
    </form>
  );
}

/** My unwrapped key for each epoch of a group. */
function useGroupKeys(conv: Conversation | undefined, privateKey: Uint8Array | null) {
  return useQuery({ ...(conv && privateKey ? groupKeysQuery(conv, privateKey) : { queryKey: ["group-keys", conv?.id], queryFn: async () => new Map<number, Uint8Array>() }), enabled: conv?.kind === "group" && !!privateKey });
}

// ---------- thread ----------

type Pending = { key: string; env: Envelope; failed?: boolean };

export function Thread({ id }: { id: string }) {
  const { me, privateKey, myPublicKey } = useSession();
  const qc = useQueryClient();
  const conv = useQuery({ queryKey: ["conversation", id], queryFn: () => api<{ conversation: Conversation }>(`/api/conversations/${id}`).then((r) => r.conversation) });
  const msgs = useQuery({ queryKey: ["messages", id], queryFn: () => api<{ messages: EncryptedMessage[] }>(`/api/conversations/${id}/messages`).then((r) => r.messages) });
  const groupKeys = useGroupKeys(conv.data, privateKey);
  const c = conv.data;
  const isGroup = c?.kind === "group";
  const isOnline = usePresence(c?.otherUser ? [c.otherUser.id] : []);
  const [plain, setPlain] = useState<Record<string, Envelope | null>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [panel, setPanel] = useState<"none" | "safety" | "group">("none");
  const bottom = useRef<HTMLDivElement>(null);
  const theirKey = c?.otherPublicKey ?? null;

  // Decrypt locally. Group messages use the key of the epoch they were sent in.
  useEffect(() => {
    if (!privateKey || !msgs.data || !c) return;
    if (isGroup && !groupKeys.data) return;
    if (!isGroup && !theirKey) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, Envelope | null> = {};
      for (const m of msgs.data) out[m.id] = plain[m.id] ? plain[m.id]! : await open(m, c, privateKey, groupKeys.data);
      if (!cancelled) setPlain(out);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.data, privateKey, theirKey, groupKeys.data, isGroup]);

  useEffect(() => { if (!isGroup && myPublicKey && theirKey) safetyCode(myPublicKey, theirKey).then(setCode); }, [myPublicKey, theirKey, isGroup]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [plain, pending.length]);

  const refresh = useCallback(async () => {
    const fresh = await qc.fetchQuery({ queryKey: ["conversation", id], queryFn: () => api<{ conversation: Conversation }>(`/api/conversations/${id}`).then((r) => r.conversation), staleTime: 0 });
    await qc.invalidateQueries({ queryKey: ["group-keys", id] });
    return fresh;
  }, [qc, id]);

  async function send(item: Pending) {
    if (!privateKey || !c) return;
    setPending((p) => p.map((x) => (x.key === item.key ? { ...x, failed: false } : x)));
    try {
      const current = qc.getQueryData<Conversation>(["conversation", id]) ?? c;
      const m = await sendEnvelope(qc, current, item.env, privateKey, item.key);
      setPlain((p) => ({ ...p, [m.id]: item.env }));
      setPending((p) => p.filter((x) => x.key !== item.key));
      if (current.kind === "group") qc.invalidateQueries({ queryKey: ["conversation", id] });
    } catch (e) {
      setPending((p) => p.map((x) => (x.key === item.key ? { ...x, failed: true } : x)));
      if (e instanceof ApiError && (e.status === 422 || e.status === 403)) setPending((p) => p.filter((x) => x.key !== item.key));
    }
  }

  const ordered = useMemo(() => msgs.data ?? [], [msgs.data]);
  const byId = useMemo(() => new Map(c?.members.map((m) => [m.user.id, m.user]) ?? []), [c]);

  if (conv.isError) return <div className="grid flex-1 place-items-center p-6"><Empty title="Conversation not found" /></div>;
  if (!c || !me) return <div className="grid flex-1 place-items-center"><Spinner /></div>;
  const other = c.otherUser;
  const iLeft = !c.myRole;
  const canSend = !!privateKey && !iLeft && (isGroup ? !!groupKeys.data : !!theirKey);

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center gap-3 border-b border-rule px-4 py-3">
        <Link href="/messages" className="md:hidden" aria-label="Back to messages"><BackIcon className="h-6 w-6" /></Link>
        {isGroup ? (
          <button onClick={() => setPanel((p) => (p === "group" ? "none" : "group"))} className="flex min-w-0 items-center gap-3 text-left">
            <GroupAvatar c={c} size={36} />
            <span className="min-w-0">
              <span className="block truncate font-semibold leading-tight">{convName(c)}</span>
              <span className="text-[12px] text-graphite">{c.members.length} people · key #{c.currentEpoch}</span>
            </span>
          </button>
        ) : other && (
          <Link href={`/u/${other.username}`} className="flex min-w-0 items-center gap-3">
            <Avatar user={other} size={36} online={isOnline(other.id)} />
            <span className="min-w-0">
              <span className="block truncate font-semibold leading-tight">{other.username}</span>
              <span className="text-[12px] text-graphite">{isOnline(other.id) ? "Online" : "Offline"}</span>
            </span>
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          {isGroup && <button onClick={() => setPanel((p) => (p === "group" ? "none" : "group"))} className="rounded-full p-1.5 hover:bg-paper/60" aria-label="Group info"><UsersIcon className="h-5 w-5" /></button>}
          <button onClick={() => setPanel((p) => (p === "safety" ? "none" : "safety"))} className="chip" aria-expanded={panel === "safety"}>
            <LockIcon className="h-3.5 w-3.5" /> Encrypted
          </button>
        </div>
      </header>

      {panel === "safety" && (
        <div className="border-b border-rule bg-paper/50 px-5 py-4 text-[13px]">
          {isGroup ? (
            <>
              <p className="font-semibold">Only current members can read new messages.</p>
              <p className="mt-1 text-graphite">Each time someone joins or leaves, a new group key (#{c.currentEpoch} now) is made and sealed separately for every member. People who leave can&apos;t read anything sent after; people who join can&apos;t read anything sent before.</p>
            </>
          ) : (
            <>
              <p className="font-semibold">Only you and {other?.username} can read these messages.</p>
              <p className="mt-1 text-graphite">To be sure no one is in the middle, compare this safety code with {other?.username} in person or on a call. It should match on both screens.</p>
              <p className="mt-2 font-mono text-[15px] tracking-wider">{code ?? "…"}</p>
            </>
          )}
        </div>
      )}

      <div className="flex-1 space-y-1.5 overflow-y-auto px-4 py-5">
        {!privateKey ? <KeyGate /> : !isGroup && !theirKey ? (
          <p className="text-center text-[14px] text-graphite">{other?.username} hasn&apos;t set up encrypted messages yet.</p>
        ) : msgs.isPending || (isGroup && groupKeys.isPending) ? <Spinner /> : (
          <>
            {ordered.length === 0 && pending.length === 0 && <p className="py-10 text-center text-[14px] text-graphite">Say hi. Messages here are end-to-end encrypted.</p>}
            {ordered.map((m, i) => {
              const mine = m.senderId === me.id;
              const t = plain[m.id];
              const sender = byId.get(m.senderId);
              const showName = isGroup && !mine && ordered[i - 1]?.senderId !== m.senderId;
              const epochChanged = isGroup && i > 0 && ordered[i - 1]!.epoch !== m.epoch;
              return (
                <div key={m.id}>
                  {epochChanged && <p className="my-3 text-center text-[11px] tracking-wide text-graphite uppercase">New group key #{m.epoch}</p>}
                  {showName && <p className="mt-2 mb-0.5 ml-1 text-[12px] font-semibold text-graphite">{sender?.username ?? "Former member"}</p>}
                  <div className={clsx("flex", mine ? "justify-end" : "justify-start")}>
                    {t ? <MessageBody env={t} mine={mine} time={clockTime(m.createdAt)} /> : (
                      <div className={clsx("rise max-w-[75%] rounded-2xl px-3.5 py-2 text-[15px] leading-snug", mine ? "bubble-mine" : "bubble-theirs")} title={clockTime(m.createdAt)}>
                        {t === undefined ? "…" : <em className="opacity-70">{isGroup ? "Sent before you joined, or with a key you don't have" : "Can't decrypt this message"}</em>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {pending.map((p) => (
              <div key={p.key} className="flex flex-col items-end opacity-60">
                <MessageBody env={p.env} mine time="Sending…" />
                {p.failed && <button onClick={() => send(p)} className="mt-1 text-[12px] font-semibold text-heart">Not sent. Tap to retry</button>}
              </div>
            ))}
            {iLeft && <p className="py-4 text-center text-[13px] text-graphite">You left this group.</p>}
          </>
        )}
        <div ref={bottom} />
      </div>

      {canSend && (
        <form className="flex items-end gap-2 border-t border-rule p-3" onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          const item: Pending = { key: newIdempotencyKey(), env: { t: "text", text: t.slice(0, 4000) } };
          setPending((p) => [...p, item]); setText(""); send(item);
        }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} maxLength={4000} placeholder="Message…" aria-label="Message"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            className="field min-h-[44px] flex-1 resize-none rounded-full px-4 py-2.5" />
          <Button aria-label="Send" disabled={!text.trim()} className="h-11 w-11 !p-0"><SendIcon className="h-5 w-5" /></Button>
        </form>
      )}

      {panel === "group" && isGroup && privateKey && <GroupPanel conv={c} privateKey={privateKey} onClose={() => setPanel("none")} onChanged={refresh} />}
    </div>
  );
}

// ---------- people picker ----------

export function PeoplePicker({ exclude, picked, onPick }: { exclude: string[]; picked: User[]; onPick: (u: User) => void }) {
  const [q, setQ] = useState("");
  const res = useQuery({
    queryKey: ["user-search", q],
    enabled: q.trim().length > 0,
    queryFn: () => api<{ users: User[] }>(`/api/users/search?q=${encodeURIComponent(q.trim())}`).then((r) => r.users),
  });
  const shown = (res.data ?? []).filter((u) => !exclude.includes(u.id) && !picked.some((p) => p.id === u.id));
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className="field" />
      {q && (
        <ul className="mt-2 max-h-48 overflow-y-auto">
          {res.isPending ? <li className="p-2"><Spinner /></li> : shown.length === 0 ? <li className="p-2 text-[13px] text-graphite">No one found.</li> : shown.map((u) => (
            <li key={u.id}>
              <button type="button" onClick={() => { onPick(u); setQ(""); }} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-paper/60">
                <Avatar user={u} size={30} /><span className="font-semibold">{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Chips({ users, onRemove }: { users: User[]; onRemove: (id: string) => void }) {
  if (!users.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {users.map((u) => (
        <span key={u.id} className="chip">
          {u.username}
          <button type="button" onClick={() => onRemove(u.id)} aria-label={`Remove ${u.username}`}><CloseIcon className="h-3 w-3" /></button>
        </span>
      ))}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal aria-label={title}>
      <div data-surface className="rise w-full max-w-md space-y-4 rounded-2xl bg-paper p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="display text-[20px]">{title}</h2>
          <button onClick={onClose} aria-label="Close"><CloseIcon className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NewGroupDialog({ onClose }: { onClose: () => void }) {
  const { me, privateKey } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  async function create() {
    if (!privateKey) return setError("Unlock your messages first (open any chat).");
    setBusy(true); setError(null);
    try {
      const all = [me!, ...people];
      const withKeys = await Promise.all(all.map(async (u) => {
        const r = await api<{ publicKey: string }>(`/api/keys/${u.id}`).catch(() => null);
        if (!r) throw new ApiError(400, `${u.username} hasn't set up encrypted messages yet.`);
        return { userId: u.id, publicKey: r.publicKey };
      }));
      const key = await newGroupKey();
      const wraps = await wrapGroupKey(key, withKeys, privateKey);
      const r = await api<{ conversation: Conversation }>("/api/conversations/group", { method: "POST", body: { title: title.trim(), memberIds: people.map((p) => p.id), wraps } });
      qc.invalidateQueries({ queryKey: ["conversations"] });
      onClose();
      router.push(`/messages/${r.conversation.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't create the group.");
      setBusy(false);
    }
  }

  return (
    <Sheet title="New group" onClose={onClose}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="Group name" aria-label="Group name" className="field" />
      <Chips users={people} onRemove={(id) => setPeople((p) => p.filter((x) => x.id !== id))} />
      {people.length < MAX_GROUP - 1 && <PeoplePicker exclude={[me.id]} picked={people} onPick={(u) => setPeople((p) => [...p, u])} />}
      <p className="text-[12px] text-graphite">A group key is created in your browser and sealed for each person. Up to {MAX_GROUP} people.</p>
      <ErrorText>{error}</ErrorText>
      <Button type="button" className="w-full" loading={busy} disabled={!title.trim() || people.length < 2} onClick={create}>
        {people.length < 2 ? "Add at least 2 people" : "Create group"}
      </Button>
    </Sheet>
  );
}

function GroupPanel({ conv, privateKey, onClose, onChanged }: { conv: Conversation; privateKey: Uint8Array; onClose: () => void; onChanged: () => Promise<Conversation> }) {
  const { me } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [adding, setAdding] = useState<User[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = conv.myRole === "owner";

  async function change(label: string, fn: (c: Conversation) => Promise<unknown>) {
    setBusy(label); setError(null);
    try {
      try { await fn(conv); }
      catch (e) {
        // Someone else changed the group first: reload and apply our change on top.
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        await fn(await onChanged());
      }
      await onChanged();
      setAdding([]);
    } catch (e) { setError(e instanceof ApiError ? e.message : "That didn't work. Try again."); }
    finally { setBusy(null); }
  }

  return (
    <Sheet title={conv.title ?? "Group"} onClose={onClose}>
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {conv.members.map((m) => (
          <li key={m.user.id} className="flex items-center gap-2.5">
            <Avatar user={m.user} size={32} />
            <span className="min-w-0 flex-1 truncate font-semibold">{m.user.username}{m.user.id === me?.id && <span className="font-normal text-graphite"> (you)</span>}</span>
            {m.role === "owner" && <span className="text-[12px] text-graphite">Owner</span>}
            {owner && m.user.id !== me?.id && (
              <Button variant="line" size="sm" loading={busy === m.user.id} onClick={() => change(m.user.id, (c) => rotate(c, privateKey, { remove: [m.user.id] }))}>Remove</Button>
            )}
          </li>
        ))}
      </ul>
      {conv.members.length < MAX_GROUP && (
        <div className="space-y-2 border-t border-rule pt-4">
          <p className="label">Add people</p>
          <Chips users={adding} onRemove={(id) => setAdding((a) => a.filter((x) => x.id !== id))} />
          <PeoplePicker exclude={conv.members.map((m) => m.user.id)} picked={adding} onPick={(u) => setAdding((a) => [...a, u])} />
          {adding.length > 0 && (
            <Button loading={busy === "add"} onClick={() => change("add", (c) => rotate(c, privateKey, { add: adding }))}>
              Add {adding.length} and make a new key
            </Button>
          )}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-between border-t border-rule pt-4">
        <Button variant="line" size="sm" loading={busy === "rotate"} onClick={() => change("rotate", (c) => rotate(c, privateKey))}>Make a new key</Button>
        <Button variant="line" size="sm" loading={busy === "leave"} onClick={async () => {
          if (!confirm("Leave this group? You won't see new messages.")) return;
          setBusy("leave");
          await api(`/api/conversations/${conv.id}/leave`, { method: "POST" }).catch(() => {});
          qc.invalidateQueries({ queryKey: ["conversations"] });
          router.replace("/messages");
        }}>Leave group</Button>
      </div>
    </Sheet>
  );
}
