/**
 * The desk is light. Dark interfaces trigger migraines, so the shell does not
 * follow the operating system and does not restore a previously saved dark
 * choice. The dark palette remains in styles.css under `data-theme="dark"`
 * and is not applied.
 */
import { useEffect } from "react";

export type ThemePref = "light";

export const THEME_KEY = "ripple-theme";
export const THEME_ORDER: ThemePref[] = ["light"];

/** Before first paint. Always light, including when storage is blocked or holds an older choice. */
export const THEME_BOOT = `(function(){try{localStorage.setItem("${THEME_KEY}","light")}catch(e){}document.documentElement.setAttribute("data-theme","light")})()`;

export function parseTheme(_raw: string | null | undefined): ThemePref {
  return "light";
}

export function readTheme(): ThemePref {
  return "light";
}

export function applyTheme(_pref?: ThemePref) {
  if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", "light");
  try {
    globalThis.localStorage?.setItem(THEME_KEY, "light");
  } catch {
    // Storage unavailable: the document attribute still holds for this page.
  }
}

export function nextTheme(_pref: ThemePref): ThemePref {
  return "light";
}

/** Light, on the server and after mount. */
export function useTheme() {
  useEffect(() => {
    applyTheme("light");
  }, []);
  return {
    pref: "light" as const,
    resolved: "light" as const,
    set: (_p?: ThemePref) => applyTheme("light"),
  };
}
