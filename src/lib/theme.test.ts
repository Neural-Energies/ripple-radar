/**
 * The desk is light. A saved dark or system preference must not paint it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { nextTheme, parseTheme, THEME_BOOT, THEME_KEY } from "./theme.ts";

test("every stored value reads as light", () => {
  assert.equal(parseTheme(null), "light");
  assert.equal(parseTheme("dark"), "light");
  assert.equal(parseTheme("system"), "light");
  assert.equal(parseTheme("light"), "light");
  assert.equal(nextTheme("light"), "light");
});

function boot(stored: string | null, throws = false) {
  let applied = "";
  let written = "";
  const localStorage = {
    getItem: (k: string) => {
      if (throws) throw new Error("blocked");
      return k === THEME_KEY ? stored : null;
    },
    setItem: (k: string, v: string) => {
      if (throws) throw new Error("blocked");
      if (k === THEME_KEY) written = v;
    },
  };
  const document = { documentElement: { setAttribute: (_: string, v: string) => (applied = v) } };
  new Function("localStorage", "document", THEME_BOOT)(localStorage, document);
  return { applied, written };
}

test("the pre-paint script forces light, including a saved dark choice and blocked storage", () => {
  assert.equal(boot("dark").applied, "light");
  assert.equal(boot("system").applied, "light");
  assert.equal(boot(null).applied, "light");
  assert.equal(boot("dark").written, "light");
  assert.equal(boot("light", true).applied, "light");
});

test("the default tokens are the light palette, and dark is opt-in only", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  const theme = css.slice(css.indexOf("@theme {"), css.indexOf("}", css.indexOf("@theme {")));
  assert.match(theme, /--color-background:\s*#f5f7fa/);
  assert.match(css, /color-scheme:\s*light/);
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf("}", css.indexOf(':root[data-theme="dark"]')));
  assert.match(dark, /--color-background:\s*#060a12/);
  const tokens = [...css.matchAll(/^\s+(--color-[a-z0-9-]+):/gm)].map((m) => m[1]!);
  const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
  for (const sel of [':root[data-theme="light"]', ':root[data-theme="system"]']) {
    const b = block(sel);
    for (const t of new Set(tokens)) assert.ok(b.includes(`${t}:`), `${sel} sets ${t}`);
  }
});
