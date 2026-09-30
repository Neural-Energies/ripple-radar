/**
 * Colour theme: dark (the default design), light, or follow the system
 * (PR #6 B01 accessibility recommendation). A per-viewer preference, kept on
 * this device; the tokens themselves live in styles.css under
 * `:root[data-theme=…]`.
 */
import { useEffect, useState } from "react";

export type ThemePref = "dark" | "light" | "system";

export const THEME_KEY = "ripple-theme";
export const THEME_ORDER: ThemePref[] = ["dark", "light", "system"];

/**
 * Runs in <head> before first paint, so a light-theme reader never sees a dark
 * flash. Kept tiny and dependency-free; storage may be unavailable.
 */
export const THEME_BOOT = `(function(){var t="dark";try{var s=localStorage.getItem("${THEME_KEY}");if(s==="light"||s==="system")t=s}catch(e){}document.documentElement.setAttribute("data-theme",t)})()`;

export function parseTheme(raw: string | null | undefined): ThemePref {
  return raw === "light" || raw === "system" ? raw : "dark";
}

export function readTheme(): ThemePref {
  try {
    return parseTheme(globalThis.localStorage?.getItem(THEME_KEY));
  } catch {
    return "dark";
  }
}

export function applyTheme(pref: ThemePref) {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", pref);
  try {
    globalThis.localStorage?.setItem(THEME_KEY, pref);
  } catch {
    // Storage unavailable: the choice holds for this page only.
  }
}

export function nextTheme(pref: ThemePref): ThemePref {
  return THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length]!;
}

/** The stored preference, and what it resolves to right now. Dark until mounted, matching the server. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("dark");
  const [systemLight, setSystemLight] = useState(false);
  useEffect(() => {
    setPref(readTheme());
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    setSystemLight(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemLight(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const resolved: "dark" | "light" = pref === "system" ? (systemLight ? "light" : "dark") : pref;
  return {
    pref,
    resolved,
    set: (p: ThemePref) => {
      applyTheme(p);
      setPref(p);
    },
  };
}
