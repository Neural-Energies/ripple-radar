/**
 * Light is the default. Dark and System persist, and System follows the OS.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { nextTheme, parseTheme, resolveTheme, THEME_BOOT, THEME_KEY } from "./theme.ts";

test("an unknown choice is light, and the three preferences are distinct", () => {
  assert.equal(parseTheme(null), "light");
  assert.equal(parseTheme("nope"), "light");
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme("system"), "system");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "system");
  assert.equal(nextTheme("system"), "light");
});

test("system is dark only when the computer asks for it", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("system", true), "dark");
});

function boot(stored: string | null, prefersDark: boolean, throws = false) {
  const attrs: Record<string, string> = {};
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
  const document = { documentElement: { setAttribute: (name: string, v: string) => (attrs[name] = v) } };
  const window = { matchMedia: () => ({ matches: prefersDark }) };
  new Function("localStorage", "document", "window", THEME_BOOT)(localStorage, document, window);
  return { applied: attrs["data-theme"] ?? "", pref: attrs["data-theme-pref"] ?? "", written };
}

test("the pre-paint script stays light unless dark or a dark system is saved", () => {
  assert.equal(boot(null, true).applied, "light");
  assert.equal(boot(null, true).written, "light");
  assert.equal(boot("dark", false).applied, "dark");
  assert.equal(boot("system", false).applied, "light");
  assert.equal(boot("system", true).applied, "dark");
  assert.equal(boot("light", true, true).applied, "light");
});

test("the default tokens are the light palette, and dark is a separate palette", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  const theme = css.slice(css.indexOf("@theme {"), css.indexOf("}", css.indexOf("@theme {")));
  assert.match(theme, /--color-background:\s*#f5f7fa/);
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf("}", css.indexOf(':root[data-theme="dark"]')));
  assert.match(dark, /--color-background:\s*#060a12/);
  assert.match(dark, /color-scheme:\s*dark/);
});
