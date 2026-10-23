// Direct and group messages, end-to-end encrypted (DECISIONS.md D7).
//  - Direct: crypto_box between the two users' key pairs.
//  - Group: a symmetric key per "epoch", wrapped for each member by whoever started the epoch.
//    Adding or removing a member starts a new epoch, so removed members can't read new messages
//    and new members can't read old ones. The server only stores wrapped keys and ciphertext.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "../db/client.js";
import { asUser } from "../db/client.js";
import { conversationMembers, conversations, groupKeys, keyBackups, messages, publicKeys } from "../db/schema.js";
import { badRequest, HttpError, notFound, parse, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { limit } from "../lib/limits.js";
import { publish } from "../infra/bus.js";
import { getUsers, type PublicUser } from "../services/hydrate.js";
import { uuidList } from "../lib/sql.js";

export const conversationsRouter = Router();
export const keysRouter = Router();

const MAX_GROUP = 32;
const b64 = z.string().regex(/^[A-Za-z0-9+/=]+$/, "Must be base64");

// ---------- keys ----------

keysRouter.get("/:userId", async (req, res) => {
  const me = requireUser(req);
  const userId = parse(z.uuid(), req.params.userId);
  const [k] = await asUser(me, (tx) => tx.select().from(publicKeys).where(eq(publicKeys.userId, userId)));
  if (!k) throw notFound("This user has no chat key yet.");
  res.json({ userId, publicKey: k.publicKey });
});

/** For Google sign-in users (no password): set up chat keys protected by a chat passcode. Once only. */
keysRouter.post("/setup", async (req, res) => {
  const me = requireUser(req);
  const body = parse(z.object({
    publicKey: b64.min(40).max(50),
    backup: z.object({ ciphertext: b64.min(60).max(200), nonce: b64.min(30).max(40), salt: b64.min(20).max(30), opsLimit: z.number().int().min(1).max(20), memLimit: z.number().int().min(8 << 20).max(1 << 30) }),
  }), req.body);
  await asUser(me, async (tx) => {
    const [existing] = await tx.select().from(publicKeys).where(eq(publicKeys.userId, me));
    if (existing) throw new HttpError(409, "Your chat keys are already set up.");
    await tx.insert(publicKeys).values({ userId: me, publicKey: body.publicKey });
    await tx.insert(keyBackups).values({ userId: me, ...body.backup, kind: "passcode" });
  });
  res.status(201).json({ ok: true });
});

// ---------- conversations ----------

type ConvRow = { id: string; kind: "direct" | "group"; title: string | null; current_epoch: number; needs_rotation: boolean; last_message_at: string | null; created_at: string; created_by: string | null };

async function membersOf(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, { userId: string; role: string; joinedEpoch: number; publicKey: string | null }[]>();
  const r = await tx.execute<{ conversation_id: string; user_id: string; role: string; joined_epoch: number; public_key: string | null }>(sql`
    select m.conversation_id, m.user_id, m.role, m.joined_epoch, k.public_key
    from conversation_members m left join public_keys k on k.user_id = m.user_id
    where m.conversation_id in ${uuidList(ids)} and m.left_at is null order by m.joined_at`);
  const out = new Map<string, { userId: string; role: string; joinedEpoch: number; publicKey: string | null }[]>();
  for (const x of r.rows) {
    const l = out.get(x.conversation_id) ?? [];
    l.push({ userId: x.user_id, role: x.role, joinedEpoch: x.joined_epoch, publicKey: x.public_key });
    out.set(x.conversation_id, l);
  }
  return out;
}

async function toConversations(tx: Tx, me: string, rows: ConvRow[]) {
  const members = await membersOf(tx, rows.map((r) => r.id));
  const users = await getUsers(tx, [...members.values()].flat().map((m) => m.userId));
  return rows.map((c) => {
    const ms = (members.get(c.id) ?? []).map((m) => ({ ...m, user: users.get(m.userId) as PublicUser }));
    const other = c.kind === "direct" ? ms.find((m) => m.userId !== me) : undefined;
    return {
      id: c.id, kind: c.kind, title: c.title, currentEpoch: c.current_epoch, needsRotation: c.needs_rotation,
      lastMessageAt: c.last_message_at ? new Date(c.last_message_at).toISOString() : null, createdAt: new Date(c.created_at).toISOString(),
      members: ms.map((m) => ({ user: m.user, role: m.role, publicKey: m.publicKey })),
      myRole: ms.find((m) => m.userId === me)?.role ?? null,
      // Direct-chat convenience fields (the client used these in v1)
      otherUser: other?.user ?? null, otherPublicKey: other?.publicKey ?? null,
    };
  });
}

const CONV_COLS = sql`c.id, c.kind, c.title, c.current_epoch, c.needs_rotation, c.last_message_at, c.created_at, c.created_by`;

conversationsRouter.get("/", async (req, res) => {
  const me = requireUser(req);
  const out = await asUser(me, async (tx) => {
    const r = await tx.execute<ConvRow>(sql`select ${CONV_COLS} from conversations c order by coalesce(c.last_message_at, c.created_at) desc limit 100`);
    return toConversations(tx, me, r.rows);
  });
  res.json({ conversations: out });
});

/** Opens (or finds) the direct conversation with another user. Safe to call repeatedly. */
conversationsRouter.post("/", async (req, res) => {
  const me = requireUser(req);
  const { userId } = parse(z.object({ userId: z.uuid() }), req.body);
  if (userId === me) throw badRequest("You can't message yourself.");
  const [a, b] = me < userId ? [me, userId] : [userId, me];
  const conv = await asUser(me, async (tx) => {
    const other = await tx.execute(sql`select 1 from users where id = ${userId}`);
    if (!other.rowCount) throw notFound("User not found.");
    // No RETURNING: under RLS, a returned row must also pass the read policy, and we only become
    // a member (able to read it) in the next statement. So the id is generated here instead.
    const newId = randomUUID();
    const ins = await tx.insert(conversations).values({ id: newId, kind: "direct", userA: a, userB: b, createdBy: me }).onConflictDoNothing();
    if (ins.rowCount) {
      await tx.insert(conversationMembers).values([{ conversationId: newId, userId: me, role: "owner" }, { conversationId: newId, userId, role: "member" }]);
    }
    const r = await tx.execute<ConvRow>(sql`select ${CONV_COLS} from conversations c where c.user_a = ${a} and c.user_b = ${b}`);
    return (await toConversations(tx, me, r.rows))[0]!;
  });
  res.json({ conversation: conv });
});

const wrapSchema = z.object({ userId: z.uuid(), wrappedKey: b64.min(40).max(200), nonce: b64.min(30).max(40) });

/** Checks a new epoch's wrapped keys cover exactly the members who'll be in the group. */
function checkWraps(wraps: { userId: string }[], members: string[]) {
  const w = new Set(wraps.map((x) => x.userId));
  if (w.size !== wraps.length || w.size !== members.length || members.some((m) => !w.has(m))) {
    throw badRequest("The new group key must be wrapped for every member, and only for them.");
  }
}

conversationsRouter.post("/group", async (req, res) => {
  const me = requireUser(req);
  const body = parse(z.object({
    title: z.string().trim().min(1, "Name the group").max(60),
    memberIds: z.array(z.uuid()).min(2, "Add at least 2 people").max(MAX_GROUP - 1),
    wraps: z.array(wrapSchema),
  }), req.body);
  const members = [...new Set([me, ...body.memberIds])];
  checkWraps(body.wraps, members);
  const conv = await asUser(me, async (tx) => {
    const keys = await tx.execute<{ user_id: string }>(sql`select user_id from public_keys where user_id in ${uuidList(members)}`);
    if (keys.rows.length !== members.length) throw badRequest("Everyone in a group needs encrypted messages set up.");
    const cid = randomUUID(); // see the direct-chat note about RETURNING under RLS
    await tx.insert(conversations).values({ id: cid, kind: "group", title: body.title, createdBy: me, currentEpoch: 1 });
    await tx.insert(conversationMembers).values(members.map((u) => ({ conversationId: cid, userId: u, role: u === me ? "owner" : "member", joinedEpoch: 1 })));
    await tx.insert(groupKeys).values(body.wraps.map((w) => ({ conversationId: cid, epoch: 1, userId: w.userId, wrappedBy: me, wrappedKey: w.wrappedKey, nonce: w.nonce })));
    const r = await tx.execute<ConvRow>(sql`select ${CONV_COLS} from conversations c where c.id = ${cid}`);
    return (await toConversations(tx, me, r.rows))[0]!;
  });
  await publish(members, "conversation:update", { id: conv.id });
  res.status(201).json({ conversation: conv });
});

conversationsRouter.get("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const conv = await asUser(me, async (tx) => {
    const r = await tx.execute<ConvRow>(sql`select ${CONV_COLS} from conversations c where c.id = ${id}`);
    return r.rows[0] ? (await toConversations(tx, me, r.rows))[0] : null;
  });
  if (!conv) throw notFound("Conversation not found.");
  res.json({ conversation: conv });
});

/** My wrapped copies of this group's keys (only epochs I was a member for). */
conversationsRouter.get("/:id/keys", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const keys = await asUser(me, (tx) => tx.select().from(groupKeys).where(and(eq(groupKeys.conversationId, id), eq(groupKeys.userId, me))));
  res.json({ keys: keys.map((k) => ({ epoch: k.epoch, wrappedBy: k.wrappedBy, wrappedKey: k.wrappedKey, nonce: k.nonce })) });
});

/**
 * Starts a new epoch: optional membership change + a fresh key wrapped for the resulting members.
 * `expectedEpoch` is optimistic locking: if someone else rotated first, this fails with 409 and the
 * client reloads and tries again.
 */
conversationsRouter.post("/:id/rotate", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const body = parse(z.object({
    expectedEpoch: z.number().int().min(0),
    add: z.array(z.uuid()).max(MAX_GROUP).default([]),
    remove: z.array(z.uuid()).max(MAX_GROUP).default([]),
    wraps: z.array(wrapSchema).min(1),
  }), req.body);
  const out = await asUser(me, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, id)).for("update");
    if (!c) throw notFound("Conversation not found.");
    if (c.kind !== "group") throw badRequest("Only groups have rotating keys.");
    if (c.currentEpoch !== body.expectedEpoch) throw new HttpError(409, "The group changed. Reload and try again.");
    const current = (await tx.select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), isNull(conversationMembers.leftAt)))).map((m) => m.userId);
    const me_ = current.find((u) => u === me);
    if (!me_) throw notFound("Conversation not found.");
    if (body.remove.includes(me)) throw badRequest("Use Leave to leave a group.");
    const next = [...new Set([...current.filter((u) => !body.remove.includes(u)), ...body.add])];
    if (next.length > MAX_GROUP) throw badRequest(`Groups can have up to ${MAX_GROUP} people.`);
    checkWraps(body.wraps, next);
    const epoch = c.currentEpoch + 1;
    if (body.remove.length) {
      await tx.update(conversationMembers).set({ leftAt: new Date() })
        .where(and(eq(conversationMembers.conversationId, id), sql`${conversationMembers.userId} in ${uuidList(body.remove)}`));
    }
    for (const u of body.add) {
      if (current.includes(u)) continue;
      await tx.insert(conversationMembers).values({ conversationId: id, userId: u, role: "member", joinedEpoch: epoch })
        .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { leftAt: null, joinedEpoch: epoch } });
    }
    await tx.insert(groupKeys).values(body.wraps.map((w) => ({ conversationId: id, epoch, userId: w.userId, wrappedBy: me, wrappedKey: w.wrappedKey, nonce: w.nonce })));
    await tx.update(conversations).set({ currentEpoch: epoch, needsRotation: false }).where(eq(conversations.id, id));
    return { epoch, notify: [...new Set([...current, ...next])] };
  });
  await publish(out.notify, "conversation:update", { id });
  res.json({ epoch: out.epoch });
});

/** Leaving can't rotate the key (you'd know the new one), so it flags the group: the next member to send rotates first. */
conversationsRouter.post("/:id/leave", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const notify = await asUser(me, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, id));
    if (!c || c.kind !== "group") throw notFound("Group not found.");
    const members = await tx.select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), isNull(conversationMembers.leftAt)));
    await tx.update(conversations).set({ needsRotation: true }).where(eq(conversations.id, id));
    await tx.update(conversationMembers).set({ leftAt: new Date() }).where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, me)));
    return members.map((m) => m.userId);
  });
  await publish(notify, "conversation:update", { id });
  res.json({ ok: true });
});

type MsgRow = { id: string; sender_id: string; epoch: number | null; ciphertext: string; nonce: string; created_at: string };
const toMsg = (m: MsgRow, conversationId: string) => ({
  id: m.id, conversationId, senderId: m.sender_id, epoch: m.epoch, ciphertext: m.ciphertext, nonce: m.nonce, createdAt: new Date(m.created_at).toISOString(),
});

conversationsRouter.get("/:id/messages", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
  const r = await asUser(me, (tx) => tx.execute<MsgRow>(sql`
    select id, sender_id, epoch, ciphertext, nonce, created_at from messages
    where conversation_id = ${id} ${before ? sql`and created_at < ${before}::timestamptz` : sql``}
    order by created_at desc limit 50`));
  res.json({ messages: r.rows.reverse().map((m) => toMsg(m, id)), hasMore: r.rows.length === 50 });
});

const sendSchema = z.object({ ciphertext: b64.min(20).max(20000), nonce: b64.min(30).max(40), epoch: z.number().int().min(1).optional() });

conversationsRouter.post("/:id/messages", limit("message"), idempotent, async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const body = parse(sendSchema, req.body);
  const out = await asUser(me, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, id));
    if (!c) throw notFound("Conversation not found.");
    if (c.kind === "group") {
      if (c.needsRotation) throw new HttpError(409, "Someone left the group. The key must be rotated before sending.");
      if (body.epoch !== c.currentEpoch) throw new HttpError(409, "The group key changed. Reload and try again.");
    }
    const [m] = await tx.insert(messages).values({ conversationId: id, senderId: me, epoch: c.kind === "group" ? body.epoch! : null, ciphertext: body.ciphertext, nonce: body.nonce }).returning();
    await tx.update(conversations).set({ lastMessageAt: m!.createdAt }).where(eq(conversations.id, id));
    const members = await tx.select({ u: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, id), isNull(conversationMembers.leftAt)));
    return { message: toMsg({ id: m!.id, sender_id: me, epoch: m!.epoch, ciphertext: m!.ciphertext, nonce: m!.nonce, created_at: m!.createdAt.toISOString() }, id), members: members.map((x) => x.u) };
  });
  await publish(out.members, "message:new", out.message);
  res.status(201).json({ message: out.message });
});
