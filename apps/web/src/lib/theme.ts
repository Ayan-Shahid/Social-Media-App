"use client";
import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";
const KEY = "glimpse:theme";

export function getThemePref(): ThemePref {
  try { const t = localStorage.getItem(KEY); return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; }
}

export function setThemePref(t: ThemePref) {
  try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode: still applies for this page */ }
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  window.dispatchEvent(new Event("glimpse:theme"));
}

/** The theme actually showing right now (resolves "system"). */
export function isDark() {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Another tab changed the theme (localStorage fires "storage" in the OTHER tabs): apply it here too. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    const t = getThemePref();
    if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    window.dispatchEvent(new Event("glimpse:theme"));
  });
}

export function useThemePref() {
  const [pref, setPref] = useState<ThemePref>("system");
  useEffect(() => {
    setPref(getThemePref());
    const on = () => setPref(getThemePref());
    window.addEventListener("glimpse:theme", on);
    return () => window.removeEventListener("glimpse:theme", on);
  }, []);
  return [pref, (t: ThemePref) => { setThemePref(t); setPref(t); }] as const;
}
