"use client";
// Live updates: new messages and who's online.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./session";
import type { EncryptedMessage } from "./types";

type Presence = Record<string, boolean>;
const Ctx = createContext<{ socket: Socket | null; presence: Presence; merge: (p: Presence) => void }>({ socket: null, presence: {}, merge: () => {} });
export const useRealtime = () => useContext(Ctx);

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [presence, setPresence] = useState<Presence>({});
  const merge = useCallback((p: Presence) => setPresence((prev) => ({ ...prev, ...p })), []);

  useEffect(() => {
    if (!me) return;
    const s = io({ path: "/socket.io", withCredentials: true });
    setSocket(s);
    s.on("message:new", (m: EncryptedMessage) => {
      qc.setQueryData<EncryptedMessage[]>(["messages", m.conversationId], (old) => (old && !old.some((x) => x.id === m.id) ? [...old, m] : old));
      qc.invalidateQueries({ queryKey: ["conversations"] });
    });
    s.on("presence", (p: { userId: string; online: boolean }) => merge({ [p.userId]: p.online }));
    return () => { s.disconnect(); setSocket(null); };
  }, [me, qc, merge]);

  return <Ctx.Provider value={{ socket, presence, merge }}>{children}</Ctx.Provider>;
}

/** Asks the server once which of these users are online; live events keep it current after that. */
export function usePresence(ids: string[]) {
  const { socket, presence, merge } = useRealtime();
  const key = ids.join(",");
  useEffect(() => {
    if (!socket || !key) return;
    const list = key.split(",");
    const ask = () => socket.emit("presence:query", list, (on: string[]) => merge(Object.fromEntries(list.map((id) => [id, on.includes(id)]))));
    if (socket.connected) ask(); else socket.once("connect", ask);
  }, [socket, key, merge]);
  return (id: string) => presence[id] === true;
}
