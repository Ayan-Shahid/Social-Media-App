// Realtime: new messages and who's online, over Socket.IO.
// The connection is only accepted from this site's origin (stops cross-site WebSocket hijacking)
// and only with a valid session cookie. Messages are already encrypted; this just relays them.
import type http from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { resolveSession, SESSION_COOKIE } from "./middleware/session.js";

let io: Server | null = null;
const online = new Map<string, number>(); // userId -> open connections

function cookieValue(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function attachRealtime(server: http.Server) {
  const allowed = new URL(config.APP_ORIGIN).origin;
  io = new Server(server, {
    path: "/socket.io",
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    // Browsers always send Origin on cross-site requests and WebSocket upgrades, so another site's
    // origin is refused. Same-site polling requests may omit it; those still need the session cookie.
    allowRequest: (req, cb) => cb(null, !req.headers.origin || req.headers.origin === allowed),
  });

  io.use(async (socket, next) => {
    const s = await resolveSession(cookieValue(socket.request.headers.cookie, SESSION_COOKIE)).catch(() => null);
    if (!s) return next(new Error("unauthorized"));
    socket.data.userId = s.userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;
    socket.join(`user:${userId}`);
    const n = (online.get(userId) ?? 0) + 1;
    online.set(userId, n);
    if (n === 1) io!.emit("presence", { userId, online: true });

    socket.on("presence:query", (ids: unknown, ack: unknown) => {
      if (typeof ack !== "function" || !Array.isArray(ids)) return;
      ack(ids.filter((x): x is string => typeof x === "string").slice(0, 200).filter((x) => online.has(x)));
    });

    socket.on("disconnect", () => {
      const left = (online.get(userId) ?? 1) - 1;
      if (left <= 0) { online.delete(userId); io!.emit("presence", { userId, online: false }); }
      else online.set(userId, left);
    });
  });
  return io;
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  if (!io) return;
  for (const id of new Set(userIds)) io.to(`user:${id}`).emit(event, payload);
}
