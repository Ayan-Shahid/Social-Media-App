"use client";
// Live updates over one WebSocket: messages, notifications, upload progress, presence, group changes.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { pulse } from "@/components/ShaderBackdrop";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./session";
import type { EncryptedMessage, Media } from "./types";

type Presence = Record<string, boolean>;
const Ctx = createContext<{ socket: Socket | null; presence: Presence; merge: (p: Presence) => void; instance: string | null }>({ socket: null, presence: {}, merge: () => {}, instance: null });
export const useRealtime = () => useContext(Ctx);

// Same origin in production (Caddy routes /socket.io). Can point at the API directly in local dev.
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [presence, setPresence] = useState<Presence>({});
  const [instance, setInstance] = useState<string | null>(null);
  const merge = useCallback((p: Presence) => setPresence((prev) => ({ ...prev, ...p })), []);

  useEffect(() => {
    if (!me) return;
    // WebSocket only: no long-polling, so no sticky sessions are needed across API instances.
    const s = SOCKET_URL ? io(SOCKET_URL, { path: "/socket.io", transports: ["websocket"], withCredentials: true }) : io({ path: "/socket.io", transports: ["websocket"], withCredentials: true });
    setSocket(s);
    s.on("hello", (h: { instance: string }) => setInstance(h.instance));
    s.on("message:new", (m: EncryptedMessage) => {
      if (m.senderId !== me.id) pulse("message"); // bubbles rise from the Messages link
      qc.setQueryData<EncryptedMessage[]>(["messages", m.conversationId], (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
      qc.invalidateQueries({ queryKey: ["conversations"] });
    });
    s.on("notification:new", (n: { type?: string }) => {
      if (n?.type === "live") { qc.invalidateQueries({ queryKey: ["live-now"] }); pulse("live"); }
      qc.invalidateQueries({ queryKey: ["unread"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    });
    s.on("media:status", (m: Media) => qc.setQueryData(["media", m.id], m));
    s.on("conversation:update", (c: { id: string }) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", c.id] });
      qc.invalidateQueries({ queryKey: ["group-keys", c.id] });
    });
    s.on("presence", (p: { userId: string; online: boolean }) => merge({ [p.userId]: p.online }));
    // After a reconnect, refetch what may have changed while we were away.
    s.io.on("reconnect", () => { qc.invalidateQueries({ queryKey: ["conversations"] }); qc.invalidateQueries({ queryKey: ["unread"] }); });
    return () => { s.disconnect(); setSocket(null); };
  }, [me, qc, merge]);

  return <Ctx.Provider value={{ socket, presence, merge, instance }}>{children}</Ctx.Provider>;
}

/** Asks once which of these users are online (shared across API instances via Redis); live events keep it current. */
export function usePresence(ids: string[]) {
  const { socket, presence, merge } = useRealtime();
  const key = ids.join(",");
  useEffect(() => {
    if (!socket || !key) return;
    const list = key.split(",");
    const ask = () => socket.emit("presence:query", list, (on: string[]) => merge(Object.fromEntries(list.map((id) => [id, on.includes(id)]))));
    if (socket.connected) ask(); else socket.once("connect", ask);
    const t = setInterval(ask, 30_000);
    return () => clearInterval(t);
  }, [socket, key, merge]);
  return (id: string) => presence[id] === true;
}
