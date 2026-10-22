// Direct messages. End-to-end encrypted: the browser encrypts each message with the recipient's
// public key before sending, and the server stores and relays only ciphertext + nonce.
// RLS makes sure only the two people in a conversation can read or add messages.
import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { asUser } from "../db/client.js";
import { conversations, messages, publicKeys } from "../db/schema.js";
import { badRequest, notFound, parse, requireUser } from "../lib/http.js";
import { idempotent } from "../middleware/idempotency.js";
import { rowToUser, userColumns, userJoin } from "./users.js";
import { emitToUsers } from "../realtime.js";

export const conversationsRouter = Router();
export const keysRouter = Router();

keysRouter.get("/:userId", async (req, res) => {
  const me = requireUser(req);
  const userId = parse(z.uuid(), req.params.userId);
  const [k] = await asUser(me, (tx) => tx.select().from(publicKeys).where(eq(publicKeys.userId, userId)));
  if (!k) throw notFound("This user has no chat key yet.");
  res.json({ userId, publicKey: k.publicKey });
});

type ConvRow = Parameters<typeof rowToUser>[0] & { id: string; last_message_at: string | null; created_at: string; public_key: string | null };

const convSql = (me: string) => sql`
  select c.id, c.last_message_at, c.created_at, k.public_key, ${userColumns}
  from conversations c
  join users u on u.id = case when c.user_a = ${me} then c.user_b else c.user_a end
  left join public_keys k on k.user_id = u.id ${userJoin}`;

const toConv = (r: ConvRow) => ({
  id: r.id, otherUser: rowToUser(r), otherPublicKey: r.public_key,
  lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null, createdAt: new Date(r.created_at).toISOString(),
});

conversationsRouter.get("/", async (req, res) => {
  const me = requireUser(req);
  const r = await asUser(me, (tx) => tx.execute<ConvRow>(sql`${convSql(me)} order by coalesce(c.last_message_at, c.created_at) desc limit 100`));
  res.json({ conversations: r.rows.map(toConv) });
});

/** Opens (or finds) the conversation with another user. Safe to call repeatedly. */
conversationsRouter.post("/", async (req, res) => {
  const me = requireUser(req);
  const { userId } = parse(z.object({ userId: z.uuid() }), req.body);
  if (userId === me) throw badRequest("You can't message yourself.");
  const [a, b] = me < userId ? [me, userId] : [userId, me];
  const conv = await asUser(me, async (tx) => {
    const other = await tx.execute(sql`select 1 from users where id = ${userId}`);
    if (!other.rowCount) throw notFound("User not found.");
    await tx.insert(conversations).values({ userA: a, userB: b }).onConflictDoNothing();
    const r = await tx.execute<ConvRow>(sql`${convSql(me)} where c.user_a = ${a} and c.user_b = ${b}`);
    return r.rows[0]!;
  });
  res.json({ conversation: toConv(conv) });
});

conversationsRouter.get("/:id", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const r = await asUser(me, (tx) => tx.execute<ConvRow>(sql`${convSql(me)} where c.id = ${id}`));
  if (!r.rows[0]) throw notFound("Conversation not found.");
  res.json({ conversation: toConv(r.rows[0]) });
});

type MsgRow = { id: string; sender_id: string; ciphertext: string; nonce: string; created_at: string };
const toMsg = (m: MsgRow | typeof messages.$inferSelect, conversationId: string) => ({
  id: m.id, conversationId,
  senderId: "sender_id" in m ? m.sender_id : m.senderId,
  ciphertext: m.ciphertext, nonce: m.nonce,
  createdAt: new Date("created_at" in m ? m.created_at : m.createdAt).toISOString(),
});

conversationsRouter.get("/:id/messages", async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
  const r = await asUser(me, (tx) => tx.execute<MsgRow>(sql`
    select id, sender_id, ciphertext, nonce, created_at from messages
    where conversation_id = ${id} ${before ? sql`and created_at < ${before}::timestamptz` : sql``}
    order by created_at desc limit 50`));
  res.json({ messages: r.rows.reverse().map((m) => toMsg(m, id)), hasMore: r.rows.length === 50 });
});

const b64 = z.string().regex(/^[A-Za-z0-9+/=]+$/, "Must be base64");
const sendSchema = z.object({ ciphertext: b64.min(20).max(20000), nonce: b64.min(30).max(40) });
const sendLimiter = rateLimit({ windowMs: 60_000, limit: 60, keyGenerator: (req) => req.userId ?? "anon", standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Slow down a little." } });

conversationsRouter.post("/:id/messages", sendLimiter, idempotent, async (req, res) => {
  const me = requireUser(req);
  const id = parse(z.uuid(), req.params.id);
  const body = parse(sendSchema, req.body);
  const out = await asUser(me, async (tx) => {
    const [c] = await tx.select().from(conversations).where(eq(conversations.id, id));
    if (!c) throw notFound("Conversation not found.");
    const [m] = await tx.insert(messages).values({ conversationId: id, senderId: me, ...body }).returning();
    await tx.update(conversations).set({ lastMessageAt: m!.createdAt }).where(eq(conversations.id, id));
    return { message: toMsg(m!, id), members: [c.userA, c.userB] };
  });
  emitToUsers(out.members, "message:new", out.message);
  res.status(201).json({ message: out.message });
});
