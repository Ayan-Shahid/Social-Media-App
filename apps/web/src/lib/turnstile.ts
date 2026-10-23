"use client";
// Cloudflare Turnstile, the "are you human" check (DECISIONS.md D20). Usually invisible: the widget
// only shows itself if Cloudflare wants an interaction. Only loaded when the API says it's switched on
// (GET /api/auth/providers returns the public site key).
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

type Turnstile = {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<Turnstile> | null = null;
function loadScript() {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load")));
    s.onerror = () => { loading = null; reject(new Error("Turnstile didn't load")); };
    document.head.appendChild(s);
  });
  return loading;
}

export const useProviders = () =>
  useQuery({ queryKey: ["providers"], queryFn: () => api<{ google: boolean; turnstile: string | null }>("/api/auth/providers"), staleTime: Infinity });

/**
 * `ref` goes on an empty <div> in the form. `getToken()` waits (up to 15 s) for a fresh token, or
 * returns undefined when Turnstile is off. Tokens are single-use: call `reset()` after each submit.
 */
export function useTurnstile(action: "login" | "register") {
  const siteKey = useProviders().data?.turnstile ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const waiters = useRef<((t: string) => void)[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let gone = false;
    loadScript().then((t) => {
      if (gone || !ref.current) return;
      widget.current = t.render(ref.current, {
        sitekey: siteKey, action, appearance: "interaction-only", "refresh-expired": "auto",
        theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        callback: (tk: string) => { token.current = tk; setFailed(false); waiters.current.splice(0).forEach((w) => w(tk)); },
        "expired-callback": () => { token.current = null; },
        "error-callback": () => { token.current = null; setFailed(true); },
      });
    }).catch(() => setFailed(true));
    return () => { gone = true; if (widget.current) window.turnstile?.remove(widget.current); widget.current = null; };
  }, [siteKey, action]);

  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!siteKey) return undefined;
    if (token.current) return token.current;
    return new Promise<string | undefined>((resolve) => {
      const t = setTimeout(() => resolve(undefined), 15_000);
      waiters.current.push((tk) => { clearTimeout(t); resolve(tk); });
    });
  }, [siteKey]);

  const reset = useCallback(() => {
    token.current = null;
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);

  return { ref, enabled: !!siteKey, failed, getToken, reset };
}
