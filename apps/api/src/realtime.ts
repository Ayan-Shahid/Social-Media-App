// Realtime over Socket.IO, across several API instances (DECISIONS.md D11).
//  - WebSocket transport only: no long-polling, so no sticky sessions are needed behind the load balancer.
//  - Every process publishes to the Redis Stream bus; every API instance delivers to its own sockets.
//  - Presence: a heartbeat sorted set in Redis. Online = heartbeat within the last 50 s. If an
//    instance crashes, its users' heartbeats stop and they go offline by themselves.
import type http from "node:http";
import { Server } from "socket.io";
import { sql } from "drizzle-orm";
import { config } from "./config.js";
import { resolveSession, SESSION_COOKIE } from "./middleware/session.js";
import { publish, subscribe } from "./infra/bus.js";
import { redis, keys } from "./infra/redis.js";
import { asUser } from "./db/client.js";

let io: Server | null = null;
let stopBus: (() => void) | null = null;
let heartbeat: NodeJS.Timeout | null = null;
const local = new Map<string, number>(); // userId -> sockets on THIS instance
const ONLINE_WINDOW_MS = 50_000;

function cookieValue(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

/** People who should see this user's online status: everyone they share a conversation with. Cached 5 min. */
async function partnersOf(userId: string): Promise<string[]> {
  const k = `partners:${userId}`;
  const hit = await redis.get(k);
  if (hit) return JSON.parse(hit);
  const r = await asUser(userId, (tx) => tx.execute<{ id: string }>(sql`
    select distinct m.user_id as id from conversation_members m
    where m.conversation_id in (select conversation_id from conversation_members where user_id = ${userId} and left_at is null)
      and m.user_id <> ${userId} and m.left_at is null`));
  const ids = r.rows.map((x) => x.id);
  await redis.set(k, JSON.stringify(ids), "EX", 300);
  return ids;
}

export async function onlineStatus(ids: string[]) {
  if (!ids.length) return [];
  const scores = await redis.zmscore(keys.presence, ...ids);
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  return ids.filter((_, i) => scores[i] !== null && Number(scores[i]) > cutoff);
}

export function attachRealtime(server: http.Server) {
  const allowed = new URL(config.APP_ORIGIN).origin;
  io = new Server(server, {
    path: "/socket.io",
    serveClient: false,
    transports: ["websocket"],
    maxHttpBufferSize: 64 * 1024,
    // Browsers always send Origin on WebSocket upgrades: refusing other origins stops cross-site WebSocket hijacking.
    allowRequest: (req, cb) => cb(null, req.headers.origin === allowed),
  });

  io.use(async (socket, next) => {
    const s = await resolveSession(cookieValue(socket.request.headers.cookie, SESSION_COOKIE)).catch(() => null);
    if (!s) return next(new Error("unauthorized"));
    socket.data.userId = s.userId;
    next();
  });

  io.on("connection", async (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);
    // Count the connection synchronously, so a disconnect can never be processed before it.
    const n = (local.get(userId) ?? 0) + 1;
    local.set(userId, n);
    // Handlers are registered BEFORE any await: an event that arrives while we're awaiting would
    // otherwise find no listener and be dropped (a presence query would never get its reply).
    socket.on("presence:query", async (ids: unknown, ack: unknown) => {
      if (typeof ack !== "function" || !Array.isArray(ids)) return;
      const list = ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
      ack(await onlineStatus(list).catch(() => []));
    });

    socket.on("disconnect", async () => {
      const left = (local.get(userId) ?? 1) - 1;
      if (left > 0) { local.set(userId, left); return; }
      local.delete(userId);
      // Mark offline now. If the user is still connected to another instance, its next heartbeat (<20 s) restores it.
      await redis.zadd(keys.presence, Date.now() - ONLINE_WINDOW_MS - 1000, userId).catch(() => {});
      partnersOf(userId).then((p) => publish(p, "presence", { userId, online: false })).catch(() => {});
    });

    await redis.zadd(keys.presence, Date.now(), userId).catch(() => {});
    if (n === 1) partnersOf(userId).then((p) => publish(p, "presence", { userId, online: true })).catch(() => {});
    // "hello" means ready: handlers are in place and this user already counts as online everywhere.
    socket.emit("hello", { instance: config.INSTANCE_ID });
  });

  // One heartbeat per instance for all its connected users.
  heartbeat = setInterval(() => {
    const ids = [...local.keys()];
    if (!ids.length) return;
    const now = Date.now();
    redis.zadd(keys.presence, ...ids.flatMap((id) => [now, id])).catch(() => {});
  }, 20_000);
  heartbeat.unref();

  // Deliver bus events to the sockets on this instance.
  stopBus = subscribe((e) => {
    for (const u of e.to) io!.to(`user:${u}`).emit(e.event, e.payload);
  });
  return io;
}

export async function closeRealtime() {
  stopBus?.();
  if (heartbeat) clearInterval(heartbeat);
  await new Promise<void>((r) => (io ? io.close(() => r()) : r()));
  io = null;
}

/** Kept for older call sites: publishes via the bus so every instance delivers it. */
export const emitToUsers = (userIds: string[], event: string, payload: unknown) => publish(userIds, event, payload);
export const localConnections = () => [...local.values()].reduce((a, b) => a + b, 0);
