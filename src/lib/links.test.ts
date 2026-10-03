/**
 * Every in-app link must name a real route. External links must be http(s).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

function routes(): Set<string> {
  const tree = readFileSync(join(SRC, "routeTree.gen.ts"), "utf8");
  const found = new Set<string>(["/"]);
  for (const match of tree.matchAll(/fullPath:\s*'([^']+)'/g)) found.add(match[1]!);
  return found;
}

function normalize(path: string): string {
  const noSearch = path.split("?")[0]!.split("#")[0]!;
  return noSearch.replace(/\$[A-Za-z0-9_]+/g, "$param");
}

test("internal links point at routes that exist", () => {
  const known = new Set([...routes()].map(normalize));
  const missing: string[] = [];
  const link = /(?:\bto=\{?["'](\/[^"']*)["']|href=["'](\/[^"'#][^"']*)["'])/g;
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(link)) {
      const target = match[1] ?? match[2];
      if (!target || target.startsWith("/__")) continue;
      if (!known.has(normalize(target))) missing.push(`${relative(ROOT, file)} → ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("external anchors are http(s), and docs hashes match a section", () => {
  const bad: string[] = [];
  const docs = readFileSync(join(SRC, "routes/docs.tsx"), "utf8");
  const ids = new Set([...docs.matchAll(/id="([^"]+)"/g)].map((m) => m[1]!));
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/href=\{?["']([^"']+)["']/g)) {
      const href = match[1]!;
      if (href.startsWith("#")) {
        if (file.endsWith("docs.tsx")) {
          const id = href.slice(1);
          if (!ids.has(id)) bad.push(`${relative(ROOT, file)} missing #${id}`);
        }
        continue;
      }
      if (href.startsWith("/")) continue;
      if (!/^https?:\/\//.test(href)) bad.push(`${relative(ROOT, file)} → ${href}`);
    }
  }
  assert.deepEqual(bad, []);
});
