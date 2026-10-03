#!/usr/bin/env node
/**
 * Assemble the Electron project the Windows installer is built from.
 * The desk server is .output/ (produced by `npm run build:desktop`).
 * The shell's own dependencies are installed in desktop-stage/, not in the
 * web app's node_modules, so the installer does not ship the whole repo.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, "desktop-stage");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "build"), { recursive: true });

writeFileSync(
  join(stage, "package.json"),
  JSON.stringify(
    {
      name: "ripple-radar",
      version: pkg.version,
      private: true,
      main: "main.cjs",
      description: "Ripple Radar — Don't trade the headline. Trade what the headline causes next.",
      author: "Neural Energies",
      dependencies: {
        "electron-updater": "6.8.9",
      },
      devDependencies: {
        electron: "44.5.1",
        "electron-builder": "26.15.3",
      },
    },
    null,
    2,
  ) + "\n",
);

for (const file of ["main.cjs", "preload.cjs", "electron-builder.yml"]) {
  cpSync(join(root, "desktop", file), join(stage, file));
}
cpSync(join(root, "desktop/build/icon.ico"), join(stage, "build/icon.ico"));
cpSync(join(root, "desktop/build/icon.png"), join(stage, "build/icon.png"));

console.log(`Staged ${stage} at version ${pkg.version}.`);
console.log("Next, in that folder: npm install");
console.log("Then: npx electron-builder --win nsis --publish never");
