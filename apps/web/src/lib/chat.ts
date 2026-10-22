// Sending end-to-end encrypted messages (DECISIONS.md D7), shared by the chat screen, the share sheet
// and story replies.
//
// What gets encrypted is a small JSON "envelope", so a message can be text, a shared post, or a reply
// or reaction to a story. The server only ever stores ciphertext: it can't tell a shared post from
// "hi", and doesn't learn which post or story it was. When the recipient opens a shared post, the
// API checks their access (RLS), so sharing a private post with a non-follower shows "unavailable".
import type { QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { decryptGroup, decryptMessage, encryptGroup, encryptMessage, newGroupKey, unwrapGroupKey, wrapGroupKey } from "./e2ee";
import type { Conversation, EncryptedMessage, User } from "./types";

export type Envelope =
  | { t: "text"; text: string }
  | { t: "post"; postId: string; text?: string }
  | { t: "story_reply"; storyId: string; storyOwner: string; thumb: string | null; text: string }
  | { t: "story_reaction"; storyId: string; storyOwner: string; thumb: string | null; emoji: string };

export const REACTIONS = ["❤️", "😂", "😮", "😢", "👏", "🔥"] as const;

export const encode = (e: Envelope) => JSON.stringify({ v: 1, ...e });

/** Messages from before envelopes existed are plain text; anything unparseable is shown as text too. */
export function decode(plain: string): Envelope {
  if (plain.startsWith("{\"v\":")) {
    try {
      const o = JSON.parse(plain) as Envelope & { v: number };
      if (o.t === "text" || o.t === "post" || o.t === "story_reply" || o.t === "story_reaction") return o;
    } catch { /* fall through */ }
  }
  return { t: "text", text: plain };
}

/** One line for previews and notifications ("Shared a post", "Reacted ❤️ to your story"). */
export function summary(e: Envelope, mine: boolean) {
  if (e.t === "text") return e.text;
  if (e.t === "post") return e.text || (mine ? "You shared a post" : "Shared a post");
  if (e.t === "story_reply") return e.text;
  return `${mine ? "You reacted" : "Reacted"} ${e.emoji} to ${mine ? "their" : "your"} story`;
}

// ---------- group keys ----------

const keyCache = new Map<string, string>(); // userId -> public key, for wrappers who have since left

export async function publicKeyOf(userId: string, conv?: Conversation) {
  const m = conv?.members.find((x) => x.user.id === userId)?.publicKey;
  if (m) return m;
  if (!keyCache.has(userId)) keyCache.set(userId, (await api<{ publicKey: string }>(`/api/keys/${userId}`)).publicKey);
  return keyCache.get(userId)!;
}

/** Unwraps my copy of each epoch's group key. */
export async function loadGroupKeys(conv: Conversation, privateKey: Uint8Array) {
  const r = await api<{ keys: { epoch: number; wrappedBy: string; wrappedKey: string; nonce: string }[] }>(`/api/conversations/${conv.id}/keys`);
  const out = new Map<number, Uint8Array>();
  for (const k of r.keys) {
    const pk = await publicKeyOf(k.wrappedBy, conv).catch(() => null);
    const key = pk ? await unwrapGroupKey(k, pk, privateKey) : null;
    if (key) out.set(k.epoch, key);
  }
  return out;
}

export const groupKeysQuery = (conv: Conversation, privateKey: Uint8Array) => ({
  queryKey: ["group-keys", conv.id], queryFn: () => loadGroupKeys(conv, privateKey),
});

/** Starts a new epoch with a fresh key wrapped for the resulting members (also used for add/remove). */
export async function rotate(conv: Conversation, privateKey: Uint8Array, change: { add?: User[]; remove?: string[] } = {}) {
  const remaining = conv.members.filter((m) => !change.remove?.includes(m.user.id)).map((m) => m.user.id);
  const ids = [...new Set([...remaining, ...(change.add ?? []).map((u) => u.id)])];
  const withKeys = await Promise.all(ids.map(async (userId) => ({ userId, publicKey: await publicKeyOf(userId, conv) })));
  const key = await newGroupKey();
  const wraps = await wrapGroupKey(key, withKeys, privateKey);
  return api<{ epoch: number }>(`/api/conversations/${conv.id}/rotate`, {
    method: "POST",
    body: { expectedEpoch: conv.currentEpoch, add: (change.add ?? []).map((u) => u.id), remove: change.remove ?? [], wraps },
  });
}

// ---------- send / read ----------

const fetchConversation = (qc: QueryClient, id: string) => qc.fetchQuery({
  queryKey: ["conversation", id], staleTime: 0,
  queryFn: () => api<{ conversation: Conversation }>(`/api/conversations/${id}`).then((r) => r.conversation),
});

async function encryptFor(qc: QueryClient, conv: Conversation, plain: string, privateKey: Uint8Array, attempt = 0): Promise<{ ciphertext: string; nonce: string; epoch?: number }> {
  if (conv.kind === "direct") {
    if (!conv.otherPublicKey) throw new ApiError(400, `${conv.otherUser?.username ?? "They"} hasn't set up encrypted messages yet.`);
    return encryptMessage(plain, conv.otherPublicKey, privateKey);
  }
  let current = conv;
  // Someone left: they still know the current key, so the next sender starts a new epoch first.
  if (current.needsRotation) {
    await rotate(current, privateKey).catch((e) => { if (!(e instanceof ApiError && e.status === 409)) throw e; });
    current = await fetchConversation(qc, conv.id);
    await qc.invalidateQueries({ queryKey: ["group-keys", conv.id] });
  }
  const keys = await qc.fetchQuery({ ...groupKeysQuery(current, privateKey), staleTime: attempt ? 0 : 60_000 });
  const k = keys.get(current.currentEpoch);
  if (!k) {
    if (attempt > 0) throw new ApiError(409, "Couldn't get the group key.");
    return encryptFor(qc, await fetchConversation(qc, conv.id), plain, privateKey, attempt + 1);
  }
  return { ...(await encryptGroup(plain, k)), epoch: current.currentEpoch };
}

/**
 * Encrypts and sends one envelope. The idempotency key stays the same across retries, so a message is
 * never stored twice. A group key that changed underneath us (409) is reloaded and retried once.
 */
export async function sendEnvelope(qc: QueryClient, conv: Conversation, e: Envelope, privateKey: Uint8Array, idempotencyKey: string): Promise<EncryptedMessage> {
  for (let attempt = 0; ; attempt++) {
    const enc = await encryptFor(qc, attempt ? await fetchConversation(qc, conv.id) : conv, encode(e), privateKey, attempt);
    try {
      const r = await api<{ message: EncryptedMessage }>(`/api/conversations/${conv.id}/messages`, {
        method: "POST", body: enc, idempotencyKey: attempt ? `${idempotencyKey}r${attempt}` : idempotencyKey,
      });
      qc.setQueryData<EncryptedMessage[]>(["messages", conv.id], (old) => (old && !old.some((x) => x.id === r.message.id) ? [...old, r.message] : old));
      qc.invalidateQueries({ queryKey: ["conversations"] });
      return r.message;
    } catch (err) {
      if (conv.kind === "group" && err instanceof ApiError && err.status === 409 && attempt === 0) {
        await qc.invalidateQueries({ queryKey: ["group-keys", conv.id] });
        continue;
      }
      throw err;
    }
  }
}

/** Decrypts one message to its envelope (null if it can't be read with the keys we have). */
export async function open(m: EncryptedMessage, conv: Conversation, privateKey: Uint8Array, groupKeys?: Map<number, Uint8Array>): Promise<Envelope | null> {
  let plain: string | null = null;
  if (conv.kind === "group") {
    const k = m.epoch ? groupKeys?.get(m.epoch) : undefined;
    plain = k ? await decryptGroup(m, k) : null;
  } else if (conv.otherPublicKey) {
    plain = await decryptMessage(m, conv.otherPublicKey, privateKey);
  }
  return plain === null ? null : decode(plain);
}

/** Finds or opens the 1:1 conversation with someone. */
export const openDirect = (userId: string) =>
  api<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: { userId } }).then((r) => r.conversation);
