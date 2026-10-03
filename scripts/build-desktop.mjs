#!/usr/bin/env node
/**
 * Production build of the desk as a Node server the Windows shell can host.
 * Does not run db:migrate — the desktop process applies PGLite migrations
 * itself, into PGLITE_DATA_DIR.
 *
 * PGLite's wasm is loaded from beside the bundled module. The bundler does
 * not copy those files, so this script does, or the desktop database never opens.
 */
import { copyFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(process.execPath, [join(root, "scripts/with-app-env.mjs"), "vite", "build"], {
  cwd: root,
  env: { ...process.env, RIPPLE_DESKTOP: "1" },
  stdio: "inherit",
});
child.on("exit", (code) => {
  if (code) process.exit(code);
  const from = join(root, "node_modules/@electric-sql/pglite/dist");
  const to = join(root, ".output/server/_libs");
  for (const file of ["pglite.wasm", "initdb.wasm", "pglite.data"]) {
    copyFileSync(join(from, file), join(to, file));
  }
  console.log("Copied PGLite wasm next to the desktop server bundle.");
});
