/**
 * Deep Navy dark (matching Research Control Center) is the default. A missing
 * or unknown choice resolves to dark. Light and System are explicit, and persist.
 */
import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "ripple-theme-navy";
export const THEME_ORDER: ThemePref[] = ["light", "dark", "system"];

export function parseTheme(raw: string | null | undefined): ThemePref {
  if (raw === "dark" || raw === "system" || raw === "light") return raw;
  return "dark";
}

export function resolveTheme(pref: ThemePref, prefersDark: boolean): ResolvedTheme {
  if (pref === "dark") return "dark";
  if (pref === "system") return prefersDark ? "dark" : "light";
  return "light";
}

export function nextTheme(pref: ThemePref): ThemePref {
  const i = THEME_ORDER.indexOf(pref);
  return THEME_ORDER[(i + 1) % THEME_ORDER.length] ?? "light";
}

/** Before first paint. Unknown storage and a blocked store both resolve to dark. */
export const THEME_BOOT = `(function(){var key="${THEME_KEY}";var pref="dark";try{var raw=localStorage.getItem(key);if(raw==="dark"||raw==="light"||raw==="system")pref=raw;else localStorage.setItem(key,"dark")}catch(e){}var dark=false;try{dark=window.matchMedia("(prefers-color-scheme: dark)").matches===true}catch(e){}var resolved=pref==="light"||(pref==="system"&&!dark)?"light":"dark";document.documentElement.setAttribute("data-theme",resolved);document.documentElement.setAttribute("data-theme-pref",pref)})()`;

function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function readTheme(): ThemePref {
  try {
    return parseTheme(globalThis.localStorage?.getItem(THEME_KEY));
  } catch {
    return "dark";
  }
}

export function applyTheme(pref: ThemePref = readTheme()): ResolvedTheme {
  const resolved = resolveTheme(pref, prefersDark());
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme-pref", pref);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#0a1324" : "#f5f7fa");
  }
  try {
    globalThis.localStorage?.setItem(THEME_KEY, pref);
  } catch {
    // The document attribute still holds for this page.
  }
  return resolved;
}

/** Dark until the saved choice is read. System follows the OS after mount. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("dark");
  const [resolved, setResolved] = useState<ResolvedTheme>("dark");

  useEffect(() => {
    const apply = (next: ThemePref) => {
      setPref(next);
      setResolved(applyTheme(next));
    };
    apply(readTheme());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply(readTheme());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return {
    pref,
    resolved,
    set: (next: ThemePref) => {
      setPref(next);
      setResolved(applyTheme(next));
    },
  };
}
