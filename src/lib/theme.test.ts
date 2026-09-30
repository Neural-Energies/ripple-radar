/**
 * The theme preference (PR #6 B01): dark by default, light or system by
 * choice, kept on this device, applied before first paint.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { nextTheme, parseTheme, THEME_BOOT, THEME_KEY } from "./theme.ts";

test("anything but light or system reads as the default dark", () => {
  assert.equal(parseTheme(null), "dark");
  assert.equal(parseTheme("blue"), "dark");
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("system"), "system");
});

test("the toggle cycles dark, light, system", () => {
  assert.equal(nextTheme("dark"), "light");
  assert.equal(nextTheme("light"), "system");
  assert.equal(nextTheme("system"), "dark");
});

function boot(stored: string | null, throws = false) {
  let applied = "";
  const localStorage = {
    getItem: (k: string) => {
      if (throws) throw new Error("blocked");
      return k === THEME_KEY ? stored : null;
    },
  };
  const document = { documentElement: { setAttribute: (_: string, v: string) => (applied = v) } };
  new Function("localStorage", "document", THEME_BOOT)(localStorage, document);
  return applied;
}

test("the pre-paint script applies the saved choice, and falls back to dark when storage is blocked", () => {
  assert.equal(boot("light"), "light");
  assert.equal(boot("system"), "system");
  assert.equal(boot(null), "dark");
  assert.equal(boot("light", true), "dark");
});

test("every colour token has a light value, for the explicit and the system selector", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  const dark = [...css.matchAll(/^\s+(--color-[a-z0-9-]+):/gm)].map((m) => m[1]!);
  const tokens = new Set(dark);
  const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
  for (const sel of [':root[data-theme="light"]', ':root[data-theme="system"]']) {
    const b = block(sel);
    for (const t of tokens) assert.ok(b.includes(`${t}:`), `${sel} sets ${t}`);
  }
});
