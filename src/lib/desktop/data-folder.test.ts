import assert from "node:assert/strict";
import { test } from "node:test";
import { backupFolderName, isBackupDir, shouldCopyName } from "./data-folder.ts";

test("backup folders are named with the local time", () => {
  assert.equal(backupFolderName(new Date(2026, 9, 3, 17, 5)), "RippleRadar-backup-2026-10-03-1705");
});

test("a backup is recognized by its marker or its database", () => {
  assert.equal(isBackupDir(["pglite", "Preferences"]), true);
  assert.equal(isBackupDir(["ripple-radar-backup.json"]), true);
  assert.equal(isBackupDir(["Downloads", "notes.txt"]), false);
});

test("browser caches are not part of a backup", () => {
  assert.equal(shouldCopyName("pglite"), true);
  assert.equal(shouldCopyName("Cache"), false);
  assert.equal(shouldCopyName("restore-after-restart.json"), false);
});
