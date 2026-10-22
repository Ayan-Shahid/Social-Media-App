"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { createKeys, unlockBackup, publicKeyFromPrivate } from "./e2ee";
import { clearKeys, loadPrivateKey, savePrivateKey } from "./keystore";
import type { KeyBackup, User } from "./types";

interface SessionCtx {
  me: User | null | undefined; // undefined = still loading
  privateKey: Uint8Array | null;
  myPublicKey: string | null;
  login(email: string, password: string): Promise<void>;
  register(username: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  unlock(password: string): Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);
export const useSession = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider missing");
  return c;
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<{ user: User }>("/api/auth/me").then((r) => r.user).catch((e) => { if (e instanceof ApiError && e.status === 401) return null; throw e; }),
    staleTime: 5 * 60_000,
  });
  const me = meQuery.data;
  const [privateKey, setPrivateKey] = useState<Uint8Array | null>(null);
  const [myPublicKey, setMyPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (!me) { setPrivateKey(null); setMyPublicKey(null); return; }
    loadPrivateKey(me.id).then(async (k) => {
      setPrivateKey(k ?? null);
      setMyPublicKey(k ? await publicKeyFromPrivate(k) : null);
    }).catch(() => setPrivateKey(null));
  }, [me]);

  const adoptKey = useCallback(async (userId: string, key: Uint8Array) => {
    await savePrivateKey(userId, key);
    setPrivateKey(key);
    setMyPublicKey(await publicKeyFromPrivate(key));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: User; keyBackup: KeyBackup | null }>("/api/auth/login", { method: "POST", body: { email, password } });
    if (r.keyBackup) await adoptKey(r.user.id, await unlockBackup(r.keyBackup, password)).catch(() => {});
    qc.clear();
    qc.setQueryData(["me"], r.user);
  }, [qc, adoptKey]);

  const register = useCallback(async (username: string, email: string, password: string) => {
    const keys = await createKeys(password);
    const r = await api<{ user: User }>("/api/auth/register", { method: "POST", body: { username, email, password, keys: keys.upload } });
    await adoptKey(r.user.id, keys.privateKey);
    qc.clear();
    qc.setQueryData(["me"], r.user);
  }, [qc, adoptKey]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    await clearKeys().catch(() => {});
    setPrivateKey(null);
    qc.clear();
    qc.setQueryData(["me"], null);
  }, [qc]);

  const unlock = useCallback(async (password: string) => {
    if (!me) return;
    const r = await api<{ keyBackup: KeyBackup | null }>("/api/auth/key-backup");
    if (!r.keyBackup) throw new Error("No chat key found for this account.");
    let key: Uint8Array;
    try { key = await unlockBackup(r.keyBackup, password); } catch { throw new Error("That password didn't unlock your messages."); }
    await adoptKey(me.id, key);
  }, [me, adoptKey]);

  const value = useMemo(() => ({ me, privateKey, myPublicKey, login, register, logout, unlock }), [me, privateKey, myPublicKey, login, register, logout, unlock]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
