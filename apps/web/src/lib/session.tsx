"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { createKeys, unlockBackup, publicKeyFromPrivate } from "./e2ee";
import { clearKeys, loadPrivateKey, savePrivateKey } from "./keystore";
import type { KeyBackup, User } from "./types";

interface Me { user: User; chatKeys: "password" | "passcode" | null; isAdmin: boolean }
interface SessionCtx {
  me: User | null | undefined; // undefined = still loading
  chatKeys: Me["chatKeys"] | undefined;
  isAdmin: boolean;
  privateKey: Uint8Array | null;
  myPublicKey: string | null;
  /** onStep reports the real steps, for the button: "verify" (server), "unlock" (Argon2 key derivation here). */
  login(email: string, password: string, onStep?: (s: "verify" | "unlock") => void, captchaToken?: string): Promise<void>;
  /** "keys" (generating the key pair + Argon2-protected backup here), then "create" (server). */
  register(username: string, email: string, password: string, onStep?: (s: "keys" | "create") => void, captchaToken?: string): Promise<void>;
  logout(): Promise<void>;
  /** Unlocks the message key with the password (or chat passcode for Google accounts). */
  unlock(secret: string): Promise<void>;
  /** Google accounts: first-time setup of message keys protected by a chat passcode. */
  setupPasscode(passcode: string): Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

// Tabs of the same browser share one session cookie (one session row on the server), but each tab
// has its own JavaScript state. This channel keeps them in step: log out in one tab and the others
// follow; unlock messages in one and the others pick up the key from IndexedDB.
type TabMsg = { type: "logout" } | { type: "login" } | { type: "keys" } | { type: "me" };
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("glimpse") : null;
export const tellOtherTabs = (m: TabMsg) => channel?.postMessage(m);
export const useSession = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider missing");
  return c;
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/auth/me").catch((e) => { if (e instanceof ApiError && e.status === 401) return null; throw e; }),
    staleTime: 5 * 60_000,
  });
  const data = meQuery.data;
  const me = data === undefined ? undefined : data?.user ?? null;
  const [privateKey, setPrivateKey] = useState<Uint8Array | null>(null);
  const [myPublicKey, setMyPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (!me) { setPrivateKey(null); setMyPublicKey(null); return; }
    loadPrivateKey(me.id).then(async (k) => {
      setPrivateKey(k ?? null);
      setMyPublicKey(k ? await publicKeyFromPrivate(k) : null);
    }).catch(() => setPrivateKey(null));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const adoptKey = useCallback(async (userId: string, key: Uint8Array) => {
    await savePrivateKey(userId, key);
    setPrivateKey(key);
    setMyPublicKey(await publicKeyFromPrivate(key));
    tellOtherTabs({ type: "keys" });
  }, []);

  const refreshMe = useCallback(() => qc.invalidateQueries({ queryKey: ["me"] }), [qc]);

  // Messages from other tabs, and "the server says this session is gone" (expired, or logged out on
  // another device's "log out everywhere"): drop local state, and the app layout redirects to login.
  useEffect(() => {
    const signedOut = () => { setPrivateKey(null); setMyPublicKey(null); qc.clear(); qc.setQueryData(["me"], null); };
    const onMsg = (e: MessageEvent<TabMsg>) => {
      if (e.data.type === "logout") signedOut();
      if (e.data.type === "login") { qc.clear(); refreshMe(); }
      if (e.data.type === "me") refreshMe();
      if (e.data.type === "keys" && me) loadPrivateKey(me.id).then(async (k) => { setPrivateKey(k ?? null); setMyPublicKey(k ? await publicKeyFromPrivate(k) : null); }).catch(() => {});
    };
    channel?.addEventListener("message", onMsg);
    window.addEventListener("glimpse:unauthorized", signedOut);
    return () => { channel?.removeEventListener("message", onMsg); window.removeEventListener("glimpse:unauthorized", signedOut); };
  }, [qc, refreshMe, me]);

  const login = useCallback(async (email: string, password: string, onStep?: (s: "verify" | "unlock") => void, captchaToken?: string) => {
    onStep?.("verify");
    const r = await api<{ user: User; keyBackup: KeyBackup | null }>("/api/auth/login", { method: "POST", body: { email, password, captchaToken } });
    if (r.keyBackup?.kind !== "passcode" && r.keyBackup) onStep?.("unlock");
    if (r.keyBackup?.kind !== "passcode" && r.keyBackup) await adoptKey(r.user.id, await unlockBackup(r.keyBackup, password)).catch(() => {});
    qc.clear();
    await refreshMe();
    tellOtherTabs({ type: "login" });
  }, [qc, adoptKey, refreshMe]);

  const register = useCallback(async (username: string, email: string, password: string, onStep?: (s: "keys" | "create") => void, captchaToken?: string) => {
    onStep?.("keys");
    const keys = await createKeys(password);
    onStep?.("create");
    const r = await api<{ user: User }>("/api/auth/register", { method: "POST", body: { username, email, password, keys: keys.upload, captchaToken } });
    await adoptKey(r.user.id, keys.privateKey);
    qc.clear();
    await refreshMe();
    tellOtherTabs({ type: "login" });
  }, [qc, adoptKey, refreshMe]);

  const logout = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    await clearKeys().catch(() => {});
    setPrivateKey(null);
    qc.clear();
    qc.setQueryData(["me"], null);
    tellOtherTabs({ type: "logout" });
  }, [qc]);

  const unlock = useCallback(async (secret: string) => {
    if (!me) return;
    const r = await api<{ keyBackup: KeyBackup | null }>("/api/auth/key-backup");
    if (!r.keyBackup) throw new Error("No message key found for this account.");
    let key: Uint8Array;
    try { key = await unlockBackup(r.keyBackup, secret); } catch { throw new Error(r.keyBackup.kind === "passcode" ? "That passcode didn't unlock your messages." : "That password didn't unlock your messages."); }
    await adoptKey(me.id, key);
  }, [me, adoptKey]);

  const setupPasscode = useCallback(async (passcode: string) => {
    if (!me) return;
    const keys = await createKeys(passcode);
    await api("/api/keys/setup", { method: "POST", body: keys.upload });
    await adoptKey(me.id, keys.privateKey);
    await refreshMe();
  }, [me, adoptKey, refreshMe]);

  const value = useMemo(() => ({
    me, chatKeys: data === undefined ? undefined : data?.chatKeys ?? null, isAdmin: !!data?.isAdmin,
    privateKey, myPublicKey, login, register, logout, unlock, setupPasscode,
  }), [me, data, privateKey, myPublicKey, login, register, logout, unlock, setupPasscode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
