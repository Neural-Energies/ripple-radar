import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { commandLaunch, quoteForCmd } from "./with-app-env.mjs";

test("cmd quoting wraps spaces and escapes quotes", () => {
  assert.equal(quoteForCmd("vite"), "vite");
  assert.equal(quoteForCmd("C:\\Program Files\\vite.cmd"), '"C:\\Program Files\\vite.cmd"');
  assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""');
});

test("Windows launches the npm cmd shim instead of a bare name", () => {
  const root = mkdtempSync(join(tmpdir(), "app-env-bin-"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", "vite.cmd"), "@echo off\r\n");
  const launch = commandLaunch("vite", ["build"], root, "win32");
  assert.match(launch.file, /cmd\.exe$/i);
  assert.equal(launch.args[0], "/d");
  assert.match(launch.args[3], /vite\.cmd/);
  assert.match(launch.args[3], /build/);
});

test("a local bin is used when it exists", () => {
  const root = mkdtempSync(join(tmpdir(), "app-env-bin-"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", "vite"), "#!/bin/sh\n");
  const launch = commandLaunch("vite", ["build"], root, "linux");
  assert.equal(launch.file, join(root, "node_modules", ".bin", "vite"));
  assert.deepEqual(launch.args, ["build"]);
});
